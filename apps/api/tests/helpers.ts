import request from 'supertest';
import type { Express } from 'express';
import type { ApiEnvelope } from '@oinur/shared';
import { prisma } from '../src/lib/prisma.js';
import { createApp } from '../src/index.js';

// 单例 App，避免每个测试文件重复创建 Express 实例
let _app: Express | null = null;
export function getTestApp(): Express {
  if (!_app) _app = createApp();
  return _app;
}

export function get(app: Express, url: string): request.Test {
  return request(app).get(url);
}

export function unwrap<T>(res: request.Response): ApiEnvelope<T> {
  return res.body as ApiEnvelope<T>;
}

export function unwrapOk<T>(res: request.Response): T {
  const body = res.body as ApiEnvelope<T>;
  if (!body.ok) throw new Error(`expected ok envelope, got error: ${body.error.code} ${body.error.message}`);
  return body.data;
}

export function unwrapErr(res: request.Response): { code: string; message: string; details?: unknown } {
  const body = res.body as ApiEnvelope<unknown>;
  if (body.ok) throw new Error('expected error envelope, got ok');
  return body.error;
}

/**
 * 优化的数据库重置
 * - 事务内批量删除，避免多次往返
 * - 禁用外键检查时批量清理，速度更快
 * - 仅清理与测试相关的核心表，公告需显式清理（SET NULL 关系不随用户级联）
 *
 * 注意：User 删除会级联大多数业务表，但为速度与确定性，显式列出关键表并行删除
 */
export async function resetUsers(): Promise<void> {
  // 使用事务 + 并行删除提升速度
  // 外键检查临时关闭，避免级联顺序问题（模板字符串形式，符合安全规则）
  await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS=0`;
  try {
    await prisma.$transaction([
      prisma.trainingLog.deleteMany({}),
      prisma.lectureLog.deleteMany({}),
      prisma.adventureLog.deleteMany({}),
      prisma.contestRecord.deleteMany({}),
      prisma.storyProgress.deleteMany({}),
      prisma.pvpRewardGrant.deleteMany({}),
      prisma.pvpRegistration.deleteMany({}),
      prisma.pvpMatch.deleteMany({}),
      prisma.problemLibraryEntry.deleteMany({}),
      prisma.userItem.deleteMany({}),
      prisma.studentTalent.deleteMany({}),
      prisma.student.deleteMany({}),
      prisma.recruitPool.deleteMany({}),
      prisma.reputationLog.deleteMany({}),
      prisma.adminAnnouncement.deleteMany({}),
      prisma.adminAuditLog.deleteMany({}),
      prisma.user.deleteMany({}),
    ]);
  } finally {
    await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS=1`;
  }
}

/**
 * 轻量重置：仅删用户（级联删其余），适用于只需清空账号的快速场景
 * 比全量事务更快，但公告需单独清理
 */
export async function resetUsersFast(): Promise<void> {
  await prisma.adminAnnouncement.deleteMany({});
  await prisma.user.deleteMany({});
}

/**
 * 快速创建测试用户（直接写库，避免 HTTP 注册开销）
 * 适用于非 auth 流程的集成测试
 */
export async function createTestUserDirect(opts: { username: string; passwordHash?: string; money?: number; reputation?: number; role?: 'USER' | 'ADMIN' } = { username: `test-${Date.now()}` }) {
  const user = await prisma.user.create({
    data: {
      username: opts.username,
      passwordHash: opts.passwordHash || '$2b$12$testhashfortestonly0000000000000000000000000000000000',
      money: opts.money ?? 0,
      reputation: opts.reputation ?? 0,
      role: opts.role ?? 'USER',
      onboardedAt: new Date(),
    },
  });
  return user;
}

/**
 * 生成唯一用户名，避免并发冲突
 */
let _seq = 0;
export function uniqueUsername(prefix = 'test'): string {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq}-${Math.random().toString(36).slice(2, 6)}`;
}
