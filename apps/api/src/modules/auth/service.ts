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
  // 软删账号视为不存在（不泄露「已注销」状态，且仍执行等耗时 bcrypt 保持侧信道均衡）
  if (!user || !user.passwordHash || user.deletedAt || !ok) throw new ApiError('INVALID_CREDENTIALS');
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

export async function deactivate(userId: number): Promise<void> {
  // 注销＝软删：仅标记 deletedAt，保留全部业务数据（学员/战报/声誉日志/审计快照等）
  // 以满足引用完整性与审计需求；登录/refresh/requireAuth 均以 deletedAt 拦截，等效账号失效，
  // 用户名保持占用不可复用（唯一索引仍指向该行）。
  await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
}

export async function bumpTokenVersionAndLogout(userId: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}
