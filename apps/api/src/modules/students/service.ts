import { randomInt } from 'node:crypto';
import type { Student } from '@prisma/client';
import { computeV, type QualityTier, type StudentView } from '@oinur/shared';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { mulberry32 } from '../../lib/rng.js';
import { aggregateMeta } from './meta.js';
import { settle, settleStudent } from './settle.js';

/**
 * 学员管理服务（M1 Task 4）：
 * - 读路径（list/detail）走 settle 纯投影，不落库；写路径（rename/dismiss）先 settleStudent 持久化；
 * - rename 消耗 rename-card×1（条件 UPDATE，扣到 0 删行）；2–12 字符校验在路由层 zod；
 * - dismiss 声誉扣减随品质档（student.md §9：COMMON−5/GOOD−10/ELITE−20/GENIUS−40，floor 0），
 *   写 ReputationLog（记实际生效 delta）；35% 概率回收 rename-card×1（种子随机，至多 1 张）；
 *   署名题保留、authorStudentId 置空。资源变动全部走「条件 UPDATE + 事务」（TECH-DESIGN §5）。
 */

const RENAME_CARD_ID = 'rename-card';

/** 开除声誉扣减表（student.md §9，随品质档；非 economy 配置项） */
export const DISMISS_REP_PENALTY: Record<QualityTier, number> = {
  COMMON: 5,
  GOOD: 10,
  ELITE: 20,
  GENIUS: 40,
};

/** 改名卡回收概率（student.md §9：35%，至多 1 张） */
const RECYCLE_PROBABILITY = 0.35;

/** 运行时种子：回收判定无需跨请求复现，取密码学随机；可复现性由注入 rng 保证 */
function newRng(): () => number {
  return mulberry32(randomInt(0, 2 ** 32));
}

function toStudentView(s: Student, talentIds: string[]): StudentView {
  return {
    id: s.id,
    name: s.name,
    sex: s.sex,
    qualityTier: s.qualityTier,
    status: s.status,
    ds: s.ds, dp: s.dp, math: s.math, graph: s.graph, greedy: s.greedy, str: s.str,
    code: s.code, thinking: s.thinking, setting: s.setting,
    mindset: s.mindset,
    focusCap: s.focusCap,
    energyMax: s.energyMax,
    energy: s.energy,
    stamina: s.stamina,
    staminaRegen: s.staminaRegen,
    counters: (s.counters ?? {}) as StudentView['counters'],
    talents: talentIds,
    v: computeV(s),
    recruitedAt: s.recruitedAt.toISOString(),
    dismissedAt: s.dismissedAt ? s.dismissedAt.toISOString() : null,
  };
}

function project(s: Student & { talents: { talentId: string }[] }, now: Date): StudentView {
  const talentIds = s.talents.map((t) => t.talentId);
  return toStudentView(settle(s, aggregateMeta(talentIds), now), talentIds);
}

/** 校验存在/归属/在册：不存在或已开除 → 404；他人学员 → 403 */
async function loadOwnedActive(userId: number, id: number): Promise<Student> {
  const s = await prisma.student.findUnique({ where: { id } });
  if (!s || s.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', { resource: 'student', id });
  if (s.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id });
  return s;
}

/** GET 列表：仅 ACTIVE；settle 纯投影（不持久化） */
export async function listStudents(userId: number, now: Date = new Date()): Promise<StudentView[]> {
  const students = await prisma.student.findMany({
    where: { userId, status: 'ACTIVE' },
    include: { talents: true },
    orderBy: { id: 'asc' },
  });
  return students.map((s) => project(s, now));
}

/** GET 详情：本人学员任意状态可见（含 counters） */
export async function getStudent(userId: number, id: number, now: Date = new Date()): Promise<StudentView> {
  const s = await prisma.student.findUnique({ where: { id }, include: { talents: true } });
  if (!s) throw new ApiError('NOT_FOUND', { resource: 'student', id });
  if (s.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id });
  return project(s, now);
}

/**
 * POST 改名：先落结算 → 事务内条件 UPDATE 扣 rename-card×1（无卡 → INSUFFICIENT_RESOURCE，
 * 扣到 0 删行）→ 改名。名字 2–12 字符由路由层 zod 保证。
 */
export async function renameStudent(
  userId: number,
  id: number,
  name: string,
  now: Date = new Date(),
): Promise<StudentView> {
  await loadOwnedActive(userId, id);
  await settleStudent(id, now);
  return prisma.$transaction(async (tx) => {
    const consumed = await tx.userItem.updateMany({
      where: { userId, itemId: RENAME_CARD_ID, quantity: { gte: 1 } },
      data: { quantity: { decrement: 1 } },
    });
    if (consumed.count === 0) {
      throw new ApiError('INSUFFICIENT_RESOURCE', { resource: RENAME_CARD_ID, need: 1 });
    }
    await tx.userItem.deleteMany({ where: { userId, itemId: RENAME_CARD_ID, quantity: { lte: 0 } } });

    const renamed = await tx.student.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { name },
    });
    if (renamed.count === 0) throw new ApiError('STATE_CONFLICT', { studentId: id });

    const student = await tx.student.findUniqueOrThrow({ where: { id }, include: { talents: true } });
    return toStudentView(student, student.talents.map((t) => t.talentId));
  });
}

export interface DismissResult {
  id: number;
  status: 'DISMISSED';
  /** 名义扣减（品质档罚则表） */
  reputationPenalty: number;
  /** 实际生效 delta（声誉 floor 0 截断后，≤0） */
  reputationDelta: number;
  /** 扣后声誉 */
  reputation: number;
  recycledRenameCard: boolean;
}

/**
 * POST 开除（student.md §9）：先落结算 → 单事务内
 * 状态条件翻转 → 声誉扣减（floor 0，条件 UPDATE 防并发）+ ReputationLog（DISMISS，记实际 delta）
 * → 35% 回收 rename-card×1（注入 rng，默认密码学随机种子）→ 署名题作者置空。
 */
export async function dismissStudent(
  userId: number,
  id: number,
  rng: () => number = newRng(),
  now: Date = new Date(),
): Promise<DismissResult> {
  const target = await loadOwnedActive(userId, id);
  await settleStudent(id, now);
  return prisma.$transaction(async (tx) => {
    const dismissed = await tx.student.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'DISMISSED', dismissedAt: now },
    });
    if (dismissed.count === 0) throw new ApiError('STATE_CONFLICT', { studentId: id });

    const penalty = DISMISS_REP_PENALTY[target.qualityTier];
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { reputation: true },
    });
    const reputation = Math.max(0, user.reputation - penalty);
    const delta = reputation - user.reputation;
    const applied = await tx.user.updateMany({
      where: { id: userId, reputation: user.reputation },
      data: { reputation },
    });
    if (applied.count === 0) throw new ApiError('STATE_CONFLICT', { userId });
    await tx.reputationLog.create({ data: { userId, delta, reason: 'DISMISS' } });

    const recycled = rng() < RECYCLE_PROBABILITY;
    if (recycled) {
      await tx.userItem.upsert({
        where: { userId_itemId: { userId, itemId: RENAME_CARD_ID } },
        create: { userId, itemId: RENAME_CARD_ID, quantity: 1 },
        update: { quantity: { increment: 1 } },
      });
    }

    await tx.problemLibraryEntry.updateMany({
      where: { authorStudentId: id },
      data: { authorStudentId: null },
    });

    return { id, status: 'DISMISSED', reputationPenalty: penalty, reputationDelta: delta, reputation, recycledRenameCard: recycled };
  });
}
