import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { signAccess, signRefresh, type AccessClaims } from '../../lib/jwt.js';
import type { MeView } from '@oinur/shared';
import type { User } from '@prisma/client';

const REFRESH_COOKIE = 'oinur_rt';

// 计时侧信道防护：用户不存在时也对其执行一次等耗时的 bcrypt.compare，消除可测量的耗时差
// cost 必须与真实哈希档位一致（env.BCRYPT_COST），否则 dummy 路径仍快约 4 倍
const DUMMY_HASH = bcrypt.hashSync('oinur-timing-dummy', env.BCRYPT_COST);

function hash(pw: string): Promise<string> {
  return bcrypt.hash(pw, env.BCRYPT_COST);
}

export function toMeView(u: User): MeView {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    money: u.money,
    reputation: u.reputation,
    badges: Array.isArray(u.badges) ? (u.badges as string[]) : [],
  };
}

export function sessionFor(u: User): { accessToken: string; refreshToken: string; me: MeView } {
  const claims: AccessClaims = { uid: u.id, role: u.role, tv: u.tokenVersion };
  return { accessToken: signAccess(claims), refreshToken: signRefresh(claims), me: toMeView(u) };
}

export function refreshCookie(token: string): string {
  const parts = [`${REFRESH_COOKIE}=${token}`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Strict'];
  if (env.NODE_ENV === 'production') parts.push('Secure');
  parts.push(`Max-Age=${7 * 24 * 3600}`);
  return parts.join('; ');
}

export function clearRefreshCookie(): string {
  const parts = [`${REFRESH_COOKIE}=`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  return parts.join('; ');
}

export async function register(input: { username: string; password: string }) {
  const exists = await prisma.user.findUnique({ where: { username: input.username }, select: { id: true } });
  if (exists) throw new ApiError('ALREADY_EXISTS', { field: 'username' });
  // 哈希放事务外：避免占用事务连接做 ~100ms 的 bcrypt 计算
  const passwordHash = await hash(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      // 建号 + 开局包（钱/声誉/固定品质学员/道具/招募池）同一事务：要么全有，要么无号
      const created = await tx.user.create({ data: { username: input.username, passwordHash } });
      const { grantOnboardingPackage } = await import('../onboarding/service.js');
      await grantOnboardingPackage(tx, created.id);
      const user = await tx.user.findUniqueOrThrow({ where: { id: created.id } });
      return sessionFor(user);
    });
  } catch (e) {
    // 并发注册 TOCTOU：唯一索引兜底（事务内仅 username 存在唯一约束，
    // 开局包天赋已去重、招募池按新用户 PK 建行，故 P2002 恒为用户名冲突）
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      throw new ApiError('ALREADY_EXISTS', { field: 'username' });
    throw e;
  }
}

export async function login(input: { username: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { username: input.username } });
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  // 注销账号已被物理删除，此处 findUnique 自然查不到，无需额外状态位
  if (!user || !user.passwordHash || !ok) throw new ApiError('INVALID_CREDENTIALS');
  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return sessionFor(updated);
}

export async function changePassword(userId: number, oldPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = user.passwordHash ? await bcrypt.compare(oldPassword, user.passwordHash) : false;
  if (!ok) throw new ApiError('INVALID_CREDENTIALS', { field: 'oldPassword' });
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hash(newPassword), tokenVersion: { increment: 1 } },
  });
}

/**
 * 注销＝物理删除（TECH-DESIGN §9.6 / §12 T4）：立刻清除该账号在库内的全部数据。
 *
 * 依赖既有 ON DELETE CASCADE 外键，单条 DELETE 即级联清空学员/道具/题库条目/声誉日志/
 * 招募池/战报/剧情进度/历练日志/讲课日志/训练日志/PVP 报名与奖励发放；AdminAuditLog.adminId、
 * PvpTournament.createdBy 与 AdminAnnouncement.authorId 走 SET NULL（审计与全站内容留存）。
 * username 唯一索引随行释放，同名可立即重新注册。
 *
 * 护栏——进行中赛事禁止注销：PvpMatch.homeUserId/awayUserId/winnerUserId 是无外键的裸 Int，
 * 而 playPending 以「双方报名行必须存在」为不变量（缺失即抛 STATE_CONFLICT 并回滚整场推进）。
 * 若参赛者在对局打完前注销，其报名行级联消失，advancePvpTournament 会在 GET 读路径上永久失败，
 * 该赛事对所有剩余选手变成死局。故 REGISTERING/RUNNING 赛事的报名者一律拒绝注销；赛事一旦
 * 推进到 FINISHED/CANCELLED（懒推进，任一次读请求即完成全部轮次）即可删除。
 */
export async function deactivate(userId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 单用户名下报名行极少，一次取回再在内存判定赛事状态（避免关系型 where 过滤）
    const registrations = await tx.pvpRegistration.findMany({
      where: { userId },
      select: { tournamentId: true, tournament: { select: { status: true } } },
    });
    const active = registrations.find(
      (row) => row.tournament.status === 'REGISTERING' || row.tournament.status === 'RUNNING',
    );
    if (active !== undefined)
      throw new ApiError('STATE_CONFLICT', {
        resource: 'pvp-tournament',
        id: active.tournamentId,
        reason: 'ACTIVE_TOURNAMENT',
      });
    await tx.user.delete({ where: { id: userId } });
  });
}

export async function bumpTokenVersionAndLogout(userId: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}
