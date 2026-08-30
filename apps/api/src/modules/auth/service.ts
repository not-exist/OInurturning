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
const DUMMY_HASH = bcrypt.hashSync('oinur-timing-dummy', 10);

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
  try {
    const user = await prisma.user.create({ data: { username: input.username, passwordHash: await hash(input.password) } });
    return sessionFor(user);
  } catch (e) {
    // 并发注册 TOCTOU：唯一索引兜底
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      throw new ApiError('ALREADY_EXISTS', { field: 'username' });
    throw e;
  }
}

export async function login(input: { username: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { username: input.username } });
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
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

export async function deactivate(userId: number): Promise<void> {
  // M0：仅删 User 行；其余业务表落地后靠 schema 级联硬删（TECH-DESIGN §9.6）
  await prisma.user.delete({ where: { id: userId } });
}

export async function bumpTokenVersionAndLogout(userId: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}
