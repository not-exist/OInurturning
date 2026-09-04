import { Prisma, type AdminAnnouncement, type AdminAuditLog, type PvpTournament } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

export interface CreateTournamentInput {
  name: string;
  size: 8 | 16 | 32;
  registerEndsAt: Date;
  autoStartAt: Date;
  prizes: unknown;
  config: unknown;
}

export interface TournamentView {
  id: number;
  name: string;
  status: PvpTournament['status'];
  size: number;
  registerEndsAt: string;
  autoStartAt: string;
  prizes: unknown;
  config: unknown;
  createdBy: number | null;
  createdAt: string;
}

export interface AnnouncementView {
  id: number;
  title: string;
  body: string;
  authorId: number;
  createdAt: string;
}

export interface UserAdminView {
  id: number;
  username: string;
  role: 'USER' | 'ADMIN';
  money: number;
  reputation: number;
  bannedAt: string | null;
  createdAt: string;
}

export interface AuditView {
  id: number;
  adminId: number | null;
  adminNameSnapshot: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: string;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

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
      payload: json(payload),
    },
  });
}

export async function createTournament(
  adminId: number,
  input: CreateTournamentInput,
): Promise<TournamentView> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.pvpTournament.create({
      data: {
        name: input.name,
        size: input.size,
        registerEndsAt: input.registerEndsAt,
        autoStartAt: input.autoStartAt,
        prizes: json(input.prizes),
        config: json(input.config),
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
  return rows.map((row) => ({ ...row, bannedAt: row.bannedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }));
}

export async function listAudits(limit = 100): Promise<AuditView[]> {
  const rows = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map(auditView);
}
