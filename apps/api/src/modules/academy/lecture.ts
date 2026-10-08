import { Prisma, type LectureLog } from '../../generated/prisma/client.js';
import {
  clamp,
  computeV,
  lectureConfigSchema,
  type LectureConfig,
  type LectureGrowthConfig,
  type LectureGrowthEntry,
  type LectureResultView,
  type LectureTierId,
  type LectureTierView,
} from '@oinur/shared';
import { requireConfig } from '../../config/require-config.js';
import { dayKey } from '../../lib/clock.js';
import { ApiError } from '../../lib/errors.js';
import { jsonWrite } from '../../lib/json.js';
import { prisma } from '../../lib/prisma.js';
import { lockStudent, lockUser } from '../../lib/row-lock.js';
import { createRandomStream, deriveSeed } from '../contest/engine/rng.js';
import { aggregateMeta } from '../students/meta.js';
import { settle } from '../students/settle.js';
import { computeLectureGrowth, thinkingReqOf } from './lecture-growth.js';
import { autoAdvanceIfNeeded } from '../tutorial/service.js';

const LECTURE_STAMINA_COST = 2;
const DAILY_LECTURE_LIMIT = 3;
const DAILY_STUDENT_LECTURE_LIMIT = 2;

function lectureConfig(): LectureConfig {
  const config = requireConfig('academy');
  if (!config.economy.lecture) throw new Error('[academy] economy.lecture 未加载');
  const parsed = lectureConfigSchema.safeParse(config.economy.lecture);
  if (!parsed.success) throw new Error('[academy] economy.lecture 配置不完整');
  return parsed.data;
}

/** 讲课成长参数（issue #56）：数值事实源 economy.yaml → lecture.growth，缺失即坏配置 */
function growthConfig(): LectureGrowthConfig {
  const growth = lectureConfig().growth;
  if (!growth) throw new Error('[academy] economy.lecture.growth 未加载');
  return growth;
}

function tierConfig(tier: string) {
  const tierId = tier as LectureTierId;
  // 单次解析后复用同一数组：safeParse 每次返回新对象，两次调用间 indexOf（引用比较）恒为 -1
  const tiers = lectureConfig().audience_tiers;
  const tierData = tiers.find((candidate) => candidate.id === tierId);
  if (tierData === undefined) throw new ApiError('VALIDATION_FAILED', { field: 'tier' });
  return { tierId, tierData, ordinal: tiers.indexOf(tierData) + 1 };
}

function repMultiplier(reputation: number): number {
  const curve = lectureConfig().reputation_pay_curve;
  return clamp(1 + reputation / curve.rep_divisor, curve.min_mult, curve.max_mult);
}

function overflowMultiplier(teachingValue: number, threshold: number): number {
  const overflow = lectureConfig().overflow_bonus;
  const steps = Math.floor(Math.max(0, teachingValue - threshold) / overflow.overflow_step);
  return 1 + Math.min(overflow.overflow_cap_pct, steps * overflow.overflow_pct);
}

function toLectureView(row: LectureLog, staminaAfter: number | null = null): LectureResultView {
  const gains = Array.isArray(row.gains) ? (row.gains as unknown as LectureGrowthEntry[]) : [];
  return {
    id: row.id,
    studentId: row.studentId,
    tier: row.tier as LectureTierId,
    teachingValue: row.teachingValue,
    threshold: row.threshold,
    thinkingReq: row.thinkingReq,
    thinkingDeficit: row.thinkingDeficit,
    forced: row.forced,
    success: row.success,
    money: row.money,
    reputation: row.reputation,
    gains,
    staminaCost: row.staminaCost,
    staminaAfter,
    createdAt: row.createdAt.toISOString(),
  };
}

async function dailyLogs(
  tx: Prisma.TransactionClient,
  userId: number,
  now: Date,
): Promise<LectureLog[]> {
  const since = new Date(now.getTime() - 8 * 86_400_000);
  const rows = await tx.lectureLog.findMany({ where: { userId, createdAt: { gte: since } } });
  return rows.filter((row) => dayKey(row.createdAt) === dayKey(now));
}

export async function getLectureTiers(userId: number): Promise<LectureTierView[]> {
  const tiers = lectureConfig().audience_tiers;
  const students = await prisma.student.findMany({
    where: { userId, status: 'ACTIVE' },
    select: { ds: true, dp: true, math: true, graph: true, greedy: true, str: true, code: true, thinking: true },
  });
  return tiers.map((tier) => ({
    id: tier.id as LectureTierId,
    threshold: tier.threshold,
    thinkingReq: thinkingReqOf(tier),
    baseMoney: tier.base_money,
    baseReputation: tier.base_reputation,
    available: students.some((student) => computeV(student) >= tier.threshold - 8),
  }));
}

export async function teachLecture(
  userId: number,
  studentId: number,
  tier: string,
  force = false,
  now: Date = new Date(),
): Promise<LectureResultView> {
  const { tierId, tierData, ordinal } = tierConfig(tier);
  const result = await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const logs = await dailyLogs(tx, userId, now);
    if (logs.length >= DAILY_LECTURE_LIMIT) {
      throw new ApiError('STATE_CONFLICT', { resource: 'lecture', reason: 'daily lecture limit reached' });
    }
    if (logs.filter((log) => log.studentId === studentId).length >= DAILY_STUDENT_LECTURE_LIMIT) {
      throw new ApiError('STATE_CONFLICT', { resource: 'lecture', reason: 'student daily lecture limit reached' });
    }

    await lockStudent(tx, studentId);
    const current = await tx.student.findUnique({ where: { id: studentId }, include: { talents: true } });
    if (current === null || current.status !== 'ACTIVE') {
      throw new ApiError('NOT_FOUND', { resource: 'student', id: studentId });
    }
    if (current.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id: studentId });
    const meta = aggregateMeta(current.talents.map((talent) => talent.talentId));
    const settled = settle(current, meta, now);
    if (settled.stamina < LECTURE_STAMINA_COST) {
      throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'stamina', need: LECTURE_STAMINA_COST });
    }
    const teachingValue = computeV(settled);
    const underThreshold = teachingValue < tierData.threshold;
    if (teachingValue < tierData.threshold - 8) {
      throw new ApiError('STATE_CONFLICT', { resource: 'lecture', reason: 'teaching value below forced-taking floor' });
    }
    if (underThreshold && !force) {
      throw new ApiError('STATE_CONFLICT', { resource: 'lecture', reason: 'force flag required below threshold' });
    }

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { reputation: true } });
    const forced = underThreshold;
    const forcedSuccess =
      !forced || createRandomStream(deriveSeed(userId, studentId, tierId, dayKey(now), logs.length), 'lecture-risk')() >= 0.4;
    const success = forcedSuccess;
    const payMultiplier = repMultiplier(user.reputation) * overflowMultiplier(teachingValue, tierData.threshold);
    const lectureIncome = meta.lecture_income ?? 0;
    const incomeMultiplier = 1 + lectureIncome / 100;
    const money =
      !success
        ? 0
        : Math.round(tierData.base_money * payMultiplier * incomeMultiplier * (forced ? 0.6 : 1));
    const reputationTarget =
      !forced
        ? Math.round(
            tierData.base_reputation *
              (1 + Math.min(lectureConfig().overflow_bonus.overflow_cap_pct, Math.floor(Math.max(0, teachingValue - tierData.threshold) / lectureConfig().overflow_bonus.overflow_step) * lectureConfig().overflow_bonus.overflow_pct)),
          )
        : success
          ? -ordinal
          : -2 * ordinal;
    const nextMindset = !forced || success ? settled.mindset : clamp(settled.mindset - 2, -10, 10);
    // 讲课成长（issue #56）：与讲砸判定同一 base seed、不同 label 的独立随机流 → 同 seed 必复现。
    // 成长只写 setting/thinking 两列，与体力/精力/心态同事务落库，任一失败整体回滚。
    const growth = computeLectureGrowth({
      growth: growthConfig(),
      tier: tierData,
      student: settled,
      meta,
      forced,
      success,
      rng: createRandomStream(
        deriveSeed(userId, studentId, tierId, dayKey(now), logs.length),
        'lecture-growth',
      ),
    });
    const updatedStudent = await tx.student.updateMany({
      where: { id: studentId, updatedAt: current.updatedAt },
      data: {
        ...growth.patch,
        stamina: settled.stamina - LECTURE_STAMINA_COST,
        energy: settled.energy,
        mindset: nextMindset,
        lastSettledAt: settled.lastSettledAt,
      },
    });
    if (updatedStudent.count !== 1) throw new ApiError('STATE_CONFLICT', { studentId });

    const nextReputation = Math.max(0, user.reputation + reputationTarget);
    if (money !== 0 || nextReputation !== user.reputation) {
      await tx.user.update({
        where: { id: userId },
        data: { ...(money === 0 ? {} : { money: { increment: money } }), reputation: nextReputation },
      });
    }
    const reputationDelta = nextReputation - user.reputation;
    if (reputationDelta !== 0) {
      await tx.reputationLog.create({ data: { userId, delta: reputationDelta, reason: 'LECTURE' } });
    }
    const row = await tx.lectureLog.create({
      data: {
        userId,
        studentId,
        tier: tierId,
        teachingValue,
        threshold: tierData.threshold,
        thinkingReq: growth.thinkingReq,
        thinkingDeficit: growth.deficit,
        forced,
        success,
        money,
        reputation: reputationDelta,
        gains: jsonWrite(growth.gains),
        staminaCost: LECTURE_STAMINA_COST,
        createdAt: now,
      },
    });
    return toLectureView(row, settled.stamina - LECTURE_STAMINA_COST);
  });
  void autoAdvanceIfNeeded(userId, 'do_lecture');
  return result;
}

export async function listLectureLogs(userId: number, limit = 20): Promise<LectureResultView[]> {
  const rows = await prisma.lectureLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: clamp(limit, 1, 100),
  });
  return rows.map(toLectureView);
}
