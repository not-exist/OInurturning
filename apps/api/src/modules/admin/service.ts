import { Prisma, type AdminAnnouncement, type AdminAuditLog, type PvpTournament } from '../../generated/prisma/client.js';
import type { AnnouncementView, AuditView, TournamentView, UserAdminView } from '@oinur/shared';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { lockPvpTournament } from '../../lib/row-lock.js';
import { validatePvpPrizes } from '../pvp/rewards.js';

export interface CreateTournamentInput {
  name: string;
  size: 8 | 16 | 32;
  registerEndsAt: Date;
  autoStartAt: Date;
  prizes: unknown;
  config: unknown;
}

/**
 * 本文件所有 Json 写入（audit payload、锦标赛 prizes/config）均用裸 cast，而非 lib/json 的
 * jsonWrite（stableSerialize 断言），是刻意保留的行为：载荷来自管理端请求体——config 是
 * z.record(z.string(), z.unknown()) 完全未校验，prizes 经 validatePvpPrizes 只校验已知桶、
 * 不重建（未知键原样保留）。HTTP JSON 可携带非 JSON 安全值（如 1e999 → Infinity），
 * Prisma 静默容错写入 null；改用断言会把写入变成 500（T5 实测记录），属行为变更，故不统一。
 */
function tournamentView(row: PvpTournament): TournamentView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    size: row.size,
    registerEndsAt: row.registerEndsAt.toISOString(),
    autoStartAt: row.autoStartAt.toISOString(),
    prizes: row.prizes,
    config: row.config,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function announcementView(row: AdminAnnouncement): AnnouncementView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    authorId: row.authorId,
    createdAt: row.createdAt.toISOString(),
  };
}

function auditView(row: AdminAuditLog): AuditView {
  return {
    id: row.id,
    adminId: row.adminId,
    adminNameSnapshot: row.adminNameSnapshot,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  adminId: number,
  action: string,
  targetType: string,
  targetId: string,
  payload: unknown,
): Promise<void> {
  const admin = await tx.user.findUniqueOrThrow({ where: { id: adminId }, select: { username: true } });
  await tx.adminAuditLog.create({
    data: {
      adminId,
      adminNameSnapshot: admin.username,
      action,
      targetType,
      targetId,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

export async function createTournament(
  adminId: number,
  input: CreateTournamentInput,
): Promise<TournamentView> {
  validatePvpPrizes(input.prizes);
  return prisma.$transaction(async (tx) => {
    const row = await tx.pvpTournament.create({
      data: {
        name: input.name,
        size: input.size,
        registerEndsAt: input.registerEndsAt,
        autoStartAt: input.autoStartAt,
        prizes: input.prizes as Prisma.InputJsonValue,
        config: input.config as Prisma.InputJsonValue,
        createdBy: adminId,
      },
    });
    await audit(tx, adminId, 'TOURNAMENT_CREATE', 'PVP_TOURNAMENT', String(row.id), {
      name: row.name,
      size: row.size,
      registerEndsAt: row.registerEndsAt.toISOString(),
      autoStartAt: row.autoStartAt.toISOString(),
    });
    return tournamentView(row);
  });
}

export async function updateTournamentPrizes(
  adminId: number,
  tournamentId: number,
  prizes: unknown,
  now: Date = new Date(),
): Promise<TournamentView> {
  validatePvpPrizes(prizes);
  return prisma.$transaction(async (tx) => {
    await lockPvpTournament(tx, tournamentId);
    const current = await tx.pvpTournament.findUnique({ where: { id: tournamentId } });
    if (current === null) throw new ApiError('NOT_FOUND', { resource: 'tournament', id: tournamentId });
    if (current.status !== 'REGISTERING' || now >= current.registerEndsAt) {
      throw new ApiError('STATE_CONFLICT', { resource: 'tournament', id: tournamentId, reason: 'prize configuration is frozen' });
    }
    const row = await tx.pvpTournament.update({ where: { id: tournamentId }, data: { prizes: prizes as Prisma.InputJsonValue } });
    await audit(tx, adminId, 'TOURNAMENT_PRIZES_UPDATE', 'PVP_TOURNAMENT', String(tournamentId), { prizes });
    return tournamentView(row);
  });
}

export async function listTournaments(): Promise<TournamentView[]> {
  const rows = await prisma.pvpTournament.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(tournamentView);
}

export async function createAnnouncement(
  adminId: number,
  title: string,
  body: string,
): Promise<AnnouncementView> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.adminAnnouncement.create({ data: { authorId: adminId, title, body } });
    await audit(tx, adminId, 'ANNOUNCEMENT_CREATE', 'ANNOUNCEMENT', String(row.id), { title });
    return announcementView(row);
  });
}

export async function listAnnouncements(limit = 50): Promise<AnnouncementView[]> {
  const rows = await prisma.adminAnnouncement.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map(announcementView);
}

export async function searchUsers(query: string | undefined, limit = 50): Promise<UserAdminView[]> {
  const rows = await prisma.user.findMany({
    where: query === undefined ? undefined : { username: { contains: query } },
    orderBy: { id: 'desc' },
    take: limit,
    select: { id: true, username: true, role: true, money: true, reputation: true, bannedAt: true, createdAt: true },
  });
  return rows.map((row) => ({
    ...row,
    bannedAt: row.bannedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * 封禁/解封用户（M5 补：此前 bannedAt 只在鉴权层读取、无操作入口）。
 * 封禁即时生效（requireAuth/refresh 每次请求读库拦截），无需 bump tokenVersion。
 * 保护性约束：ADMIN 账号（含自己）不可被封禁，避免管理员互相锁死。
 */
export async function setUserBan(
  adminId: number,
  targetId: number,
  banned: boolean,
): Promise<UserAdminView> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetId } });
    if (target === null) throw new ApiError('NOT_FOUND', { resource: 'user', id: targetId });
    if (target.role === 'ADMIN') {
      throw new ApiError('FORBIDDEN', { resource: 'user', id: targetId, reason: 'cannot ban an admin' });
    }
    const row = await tx.user.update({
      where: { id: targetId },
      data: { bannedAt: banned ? new Date() : null },
      select: { id: true, username: true, role: true, money: true, reputation: true, bannedAt: true, createdAt: true },
    });
    await audit(tx, adminId, banned ? 'USER_BAN' : 'USER_UNBAN', 'USER', String(targetId), { banned });
    return {
      ...row,
      bannedAt: row.bannedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function listAudits(limit = 100): Promise<AuditView[]> {
  const rows = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map(auditView);
}
