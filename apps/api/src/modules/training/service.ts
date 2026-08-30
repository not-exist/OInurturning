import { randomInt } from 'node:crypto';
import { Prisma, type ProblemLibraryEntry, type Student } from '@prisma/client';
import { DIMENSIONS, type DimensionKey } from '@oinur/shared';
import { getConfig } from '../../config/loader.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { mulberry32 } from '../../lib/rng.js';
import { aggregateMeta } from '../students/meta.js';
import { settle } from '../students/settle.js';
import {
  BOOK_MULT,
  DIM_META,
  QUALITY_MULT,
  TRAINING_BASE,
  computeCost,
  computeDelta,
  computeSecondaryGains,
  type RareGain,
  type TrainingKind,
} from './gains.js';

/**
 * 训练服务（M1 Task 6，权威：docs/systems/student.md §4 / docs/data/economy.yaml）：
 * - 三种训练基本同构：锁学员行 → settle 投影 → 校验（ACTIVE/stamina≥1/钱足/耗材足）→
 *   单事务内 条件 UPDATE 扣钱+体力 → 主收益落 dim → 附带成长 → 消耗书/题 → 返回 TrainingResult；
 * - 所有钱/体力/道具变动一律走「条件 UPDATE + 事务」（TECH-DESIGN §5），任一失败整体回滚；
 * - 定向需要 bookItemId（六维书，匹配目标维）；专项需要本人未消耗的 ProblemLibraryEntry。
 */

function requireConfig() {
  const config = getConfig();
  if (!config) throw new Error('[training] CONFIG 未加载：importConfigs() 必须先于游戏逻辑执行');
  return config;
}

/** 运行时种子：训练无需跨请求复现，取密码学随机；可复现性由注入 rng 的 gains 层保证 */
function newRng(): () => number {
  return mulberry32(randomInt(0, 2 ** 32));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface TrainingInput {
  kind: TrainingKind;
  userId: number;
  studentId: number;
  /** 定向：目标维；基础/专项绕开 */
  dim?: DimensionKey;
  /** 定向：六维书 itemId（缺省为灰书） */
  bookItemId?: string;
  /** 专项：预制题 id */
  problemId?: number;
}

export interface TrainingResult {
  dim: DimensionKey;
  /** 主收益（浮点累积，落在指定/随机维） */
  delta: number;
  /** 附带成长清单（code/thinking/setting/mindset/focus_cap/stamina_regen） */
  rareGains: RareGain[];
  cost: number;
  staminaAfter: number;
}

/** 校验存在/归属/在册（事务前快失败）；事务内再复核 */
async function loadOwnedActive(userId: number, id: number): Promise<Student> {
  const s = await prisma.student.findUnique({ where: { id } });
  if (!s || s.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', { resource: 'student', id });
  if (s.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id });
  return s;
}

/** 基础训练：随机一维（均匀），base 1.6 */
export async function basicTrain(
  userId: number,
  studentId: number,
  rng: () => number = newRng(),
  now: Date = new Date(),
): Promise<TrainingResult> {
  await loadOwnedActive(userId, studentId);
  const dim = DIMENSIONS[Math.floor(rng() * DIMENSIONS.length)];
  return runTraining({ kind: 'basic', userId, studentId, dim }, rng, now);
}

/** 定向训练：自选维，base 2.0 × BookMult；耗对应六维书×1 */
export async function directedTrain(
  userId: number,
  studentId: number,
  dim: DimensionKey,
  bookItemId: string | undefined,
  rng: () => number = newRng(),
  now: Date = new Date(),
): Promise<TrainingResult> {
  await loadOwnedActive(userId, studentId);
  return runTraining({ kind: 'directed', userId, studentId, dim, bookItemId }, rng, now);
}

/** 专项训练：自选维（=题 dominantDim），base 3.2 × QualityMult；耗预制题×1 */
export async function specializedTrain(
  userId: number,
  studentId: number,
  problemId: number,
  rng: () => number = newRng(),
  now: Date = new Date(),
): Promise<TrainingResult> {
  await loadOwnedActive(userId, studentId);
  return runTraining({ kind: 'specialized', userId, studentId, problemId }, rng, now);
}

async function resolveProblem(tx: Prisma.TransactionClient, input: TrainingInput): Promise<ProblemLibraryEntry> {
  const p = await tx.problemLibraryEntry.findUnique({ where: { id: input.problemId! } });
  if (!p) throw new ApiError('NOT_FOUND', { resource: 'problem', id: input.problemId });
  if (p.userId !== input.userId) throw new ApiError('FORBIDDEN', { resource: 'problem', id: input.problemId });
  if (p.consumedAt) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'problem', id: input.problemId, reason: '已被消耗' });
  if (!(DIMENSIONS as readonly string[]).includes(p.dominantDim)) {
    throw new ApiError('VALIDATION_FAILED', { resource: 'problem', id: input.problemId, dominantDim: p.dominantDim });
  }
  return p;
}

/** 定向书归属校验：bookItemId 必须形如 book-<match subject>-<rarity> 且稀有度已知 */
function bookFor(dim: DimensionKey, bookItemId: string | undefined): { itemId: string; mult: number } {
  const { bookSubject } = DIM_META[dim];
  const itemId = bookItemId ?? `book-${bookSubject}-gray`;
  const m = /^book-(.+)-(.+)$/.exec(itemId);
  if (!m) throw new ApiError('VALIDATION_FAILED', { resource: 'book', itemId, reason: '非法书籍 id' });
  if (m[1] !== bookSubject) {
    throw new ApiError('VALIDATION_FAILED', { resource: 'book', itemId, dim, reason: `书籍科目与目标维不符（需 book-${bookSubject}-*）` });
  }
  const mult = BOOK_MULT[m[2]];
  if (mult === undefined) throw new ApiError('VALIDATION_FAILED', { resource: 'book', itemId, reason: '未知书籍稀有度' });
  return { itemId, mult };
}

async function runTraining(
  input: TrainingInput,
  rng: () => number,
  now: Date,
): Promise<TrainingResult> {
  const config = requireConfig();
  const training = config.economy.training;
  const { kind, userId } = input;

  // 事务前定向书/题快检（防无谓事务开销）；真实归属在事务内复核
  const book = kind === 'directed' ? bookFor(input.dim!, input.bookItemId) : null;
  if (input.problemId != null && kind === 'specialized') {
    const p = await prisma.problemLibraryEntry.findUnique({ where: { id: input.problemId } });
    if (!p) throw new ApiError('NOT_FOUND', { resource: 'problem', id: input.problemId });
    if (p.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'problem', id: input.problemId });
  }

  return prisma.$transaction(async (tx) => {
    // 1. 锁学员行（写事务内串行化并发训练）
    await tx.$queryRaw`SELECT id FROM Student WHERE id = ${input.studentId} FOR UPDATE`;
    const student = await tx.student.findUniqueOrThrow({ where: { id: input.studentId }, include: { talents: true } });
    if (student.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id: input.studentId });
    if (student.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', { resource: 'student', id: input.studentId });

    // 2. settle 投影（懒结算随现实时间恢复，锚点推进）
    const meta = aggregateMeta(student.talents.map((t) => t.talentId));
    const settled = settle(student, meta, now);
    if (settled.stamina < 1) throw new ApiError('STATE_CONFLICT', { studentId: input.studentId, reason: '体力不足' });

    // 3. 费用（N=在册学员数）
    const ownedStudents = await tx.student.count({ where: { userId, status: 'ACTIVE' } });
    const moneyBase = training[kind].money_base;
    const cost = computeCost({ moneyBase, coeff: training.student_coeff, ownedStudents });

    // 4. 条件 UPDATE 扣钱（不足 → INSUFFICIENT_RESOURCE）
    const paid = await tx.user.updateMany({
      where: { id: userId, money: { gte: cost } },
      data: { money: { decrement: cost } },
    });
    if (paid.count === 0) throw new ApiError('INSUFFICIENT_RESOURCE', { need: cost, resource: 'money' });

    // 5. 解析目标维与倍率
    let dim: DimensionKey;
    let bookMult = 1;
    let qualityMult = 1;
    if (kind === 'basic') {
      dim = input.dim!;
    } else if (kind === 'directed') {
      dim = input.dim!;
      bookMult = book!.mult;
    } else {
      const problem = await resolveProblem(tx, input);
      const pdim = problem.dominantDim as DimensionKey;
      dim = pdim;
      const mult = QUALITY_MULT[problem.rarity];
      if (mult === undefined) throw new ApiError('VALIDATION_FAILED', { resource: 'problem', id: problem.id, rarity: problem.rarity });
      qualityMult = mult;
    }

    // 6. 主收益
    const { column, metaKey } = DIM_META[dim];
    const cur = settled[column] as number;
    const delta = computeDelta({
      base: TRAINING_BASE[kind],
      bookMult,
      qualityMult,
      meta,
      dimMetaKey: metaKey,
      cur,
    });

    // 7. 附带成长（rng 顺序固定，见 gains.computeSecondaryGains）
    const secondary = computeSecondaryGains({ type: kind, student: settled, meta, rng });

    // 8. 组装写回与条件 UPDATE（stamina≥1 前置 + 乐观锁）
    const staminaAfter = settled.stamina - 1;
    const data: Prisma.StudentUpdateManyMutationInput = {
      ...secondary.patch,
      [column]: clamp(cur + delta, 0, 100),
      stamina: staminaAfter,
      lastSettledAt: now,
    };
    const updated = await tx.student.updateMany({
      where: { id: input.studentId, updatedAt: student.updatedAt, stamina: { gte: 1 } },
      data,
    });
    if (updated.count === 0) throw new ApiError('STATE_CONFLICT', { studentId: input.studentId });

    // 9. 消耗耗材
    if (kind === 'directed') {
      const consumed = await tx.userItem.updateMany({
        where: { userId, itemId: book!.itemId, quantity: { gte: 1 } },
        data: { quantity: { decrement: 1 } },
      });
      if (consumed.count === 0) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: book!.itemId, need: 1 });
      await tx.userItem.deleteMany({ where: { userId, itemId: book!.itemId, quantity: { lte: 0 } } });
    } else if (kind === 'specialized') {
      const used = await tx.problemLibraryEntry.updateMany({
        where: { id: input.problemId!, userId, consumedAt: null },
        data: { consumedAt: now },
      });
      if (used.count === 0) {
        const p = await tx.problemLibraryEntry.findUnique({ where: { id: input.problemId! } });
        if (!p) throw new ApiError('NOT_FOUND', { resource: 'problem', id: input.problemId });
        throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'problem', id: input.problemId, reason: '已被消耗' });
      }
    }

    return { dim, delta, rareGains: secondary.rareGains, cost, staminaAfter };
  });
}
