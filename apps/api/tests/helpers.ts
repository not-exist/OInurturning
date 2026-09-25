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
 *
 * `FOREIGN_KEY_CHECKS` 是**会话级**变量，必须与删除语句跑在同一条连接上，
 * 因此这里用交互式事务（回调形式）而非数组形式：数组形式的 `$transaction`
 * 与外层的两条 `$executeRaw` 会从连接池里各自取连接，导致
 *   1) 关闭外键检查对真正执行删除的那条连接不生效；
 *   2) `SET ...=0` 永久残留在池中某条连接上，之后任何复用该连接的用例里
 *      ON DELETE CASCADE / SET NULL 都会静默失效，产生孤儿行。
 * Prisma 6 的 Rust engine 自带连接池，恰好掩盖了这一点；Prisma 7 改用
 * driver adapter（mariadb pool）后连接复用模式变化，问题才显形。
 */
export async function resetUsers(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 外键检查临时关闭，避免级联顺序问题（模板字符串形式，符合安全规则）
    await tx.$executeRaw`SET FOREIGN_KEY_CHECKS=0`;
    try {
      await tx.trainingLog.deleteMany({});
      await tx.lectureLog.deleteMany({});
      await tx.adventureLog.deleteMany({});
      await tx.contestRecord.deleteMany({});
      await tx.storyProgress.deleteMany({});
      await tx.pvpRewardGrant.deleteMany({});
      await tx.pvpRegistration.deleteMany({});
      await tx.pvpMatch.deleteMany({});
      await tx.problemLibraryEntry.deleteMany({});
      await tx.userItem.deleteMany({});
      await tx.studentTalent.deleteMany({});
      await tx.student.deleteMany({});
      await tx.recruitPool.deleteMany({});
      await tx.reputationLog.deleteMany({});
      await tx.adminAnnouncement.deleteMany({});
      await tx.adminAuditLog.deleteMany({});
      // ShopPurchaseLog 随 user 级联删除，但本事务关闭了外键检查（见上），
      // 不显式清理会残留孤儿行，污染后续用例的每日/每周限购统计
      await tx.shopPurchaseLog.deleteMany({});
      await tx.user.deleteMany({});
    } finally {
      // 同一连接上恢复，杜绝 FOREIGN_KEY_CHECKS=0 泄漏回连接池
      await tx.$executeRaw`SET FOREIGN_KEY_CHECKS=1`;
    }
  });
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
 * `tutorialCompleted` 默认 true：业务用例不关心引导锁，需要测锁定行为时显式传 false
 */
export async function createTestUserDirect(opts: { username: string; passwordHash?: string; money?: number; reputation?: number; role?: 'USER' | 'ADMIN'; tutorialCompleted?: boolean } = { username: `test-${Date.now()}` }) {
  const tutorialCompleted = opts.tutorialCompleted ?? true;
  const user = await prisma.user.create({
    data: {
      username: opts.username,
      passwordHash: opts.passwordHash || '$2b$12$testhashfortestonly0000000000000000000000000000000000',
      money: opts.money ?? 0,
      reputation: opts.reputation ?? 0,
      role: opts.role ?? 'USER',
      onboardedAt: new Date(),
      tutorialStep: tutorialCompleted ? 999 : 0,
      tutorialCompleted,
    },
  });
  return user;
}

/**
 * 测试便利：直接把账号标记为已完成引导（业务用例不关心引导锁定时使用）
 * 服务端守卫 `requireTutorialForApi` 会对未完成引导的账号锁全部业务 API，
 * 因此 HTTP 注册的测试账号需要显式解锁，而不是放宽服务端守卫。
 */
export async function unlockTutorial(userId: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tutorialStep: 999, tutorialCompleted: true } });
}

/**
 * 生成唯一用户名，避免并发冲突
 */
let _seq = 0;
export function uniqueUsername(prefix = 'test'): string {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq}-${Math.random().toString(36).slice(2, 6)}`;
}
