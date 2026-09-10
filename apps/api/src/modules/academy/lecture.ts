import { Prisma, type LectureLog } from '@prisma/client';
import { computeV, lectureConfigSchema, type LectureConfig } from '@oinur/shared';
import { getConfig } from '../../config/loader.js';
import { dayKey } from '../../lib/clock.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { createRandomStream, deriveSeed } from '../contest/engine/rng.js';
import { aggregateMeta } from '../students/meta.js';
import { settle } from '../students/settle.js';

export type LectureTierId = 'beginner' | 'junior' | 'senior' | 'provincial' | 'national';

export interface LectureTierView {
  id: LectureTierId;
  threshold: number;
  baseMoney: number;
  baseReputation: number;
  available: boolean;
}

export interface LectureResultView {
  id: number;
  studentId: number;
  tier: LectureTierId;
  teachingValue: number;
  threshold: number;
  forced: boolean;
  success: boolean;
  money: number;
  reputation: number;
  staminaCost: number;
  staminaAfter: number | null;
  createdAt: string;
}

const LECTURE_STAMINA_COST = 2;
const DAILY_LECTURE_LIMIT = 3;
const DAILY_STUDENT_LECTURE_LIMIT = 2;

function lectureConfig(): LectureConfig {
  const config = getConfig();
  if (!config?.economy.lecture) throw new Error('[academy] economy.lecture 未加载');
  const parsed = lectureConfigSchema.safeParse(config.economy.lecture);
  if (!parsed.success) throw new Error('[academy] economy.lecture 配置不完整');
  return parsed.data;
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
  return Math.min(curve.max_mult, Math.max(curve.min_mult, 1 + reputation / curve.rep_divisor));
}

function overflowMultiplier(teachingValue: number, threshold: number): number {
  const overflow = lectureConfig().overflow_bonus;
  const steps = Math.floor(Math.max(0, teachingValue - threshold) / overflow.overflow_step);
  return 1 + Math.min(overflow.overflow_cap_pct, steps * overflow.overflow_pct);
}

function clampMindset(value: number): number {
  return Math.min(10, Math.max(-10, value));
}

function toLectureView(row: LectureLog, staminaAfter: number | null = null): LectureResultView {
  return {
    id: row.id,
    studentId: row.studentId,
    tier: row.tier as LectureTierId,
    teachingValue: row.teachingValue,
    threshold: row.threshold,
    forced: row.forced,
    success: row.success,
    money: row.money,
    reputation: row.reputation,
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
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const logs = await dailyLogs(tx, userId, now);
    if (logs.length >= DAILY_LECTURE_LIMIT) {
      throw new ApiError('STATE_CONFLICT', { resource: 'lecture', reason: 'daily lecture limit reached' });
    }
    if (logs.filter((log) => log.studentId === studentId).length >= DAILY_STUDENT_LECTURE_LIMIT) {
      throw new ApiError('STATE_CONFLICT', { resource: 'lecture', reason: 'student daily lecture limit reached' });
    }

    await tx.$queryRaw`SELECT id FROM Student WHERE id = ${studentId} FOR UPDATE`;
    const current = await tx.student.findUnique({ where: { id: studentId }, include: { talents: true } });
    if (current === null || current.status !== 'ACTIVE') {
      throw new ApiError('NOT_FOUND', { resource: 'student', id: studentId });
    }
    if (current.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id: studentId });
    const settled = settle(current, aggregateMeta(current.talents.map((talent) => talent.talentId)), now);
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
    const lectureIncome = aggregateMeta(current.talents.map((talent) => talent.talentId)).lecture_income ?? 0;
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
    const nextMindset = !forced || success ? settled.mindset : clampMindset(settled.mindset - 2);
    const updatedStudent = await tx.student.updateMany({
      where: { id: studentId, updatedAt: current.updatedAt },
      data: {
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
        forced,
        success,
        money,
        reputation: reputationDelta,
        staminaCost: LECTURE_STAMINA_COST,
        createdAt: now,
      },
    });
    return toLectureView(row, settled.stamina - LECTURE_STAMINA_COST);
  });
}

export async function listLectureLogs(userId: number, limit = 20): Promise<LectureResultView[]> {
  const rows = await prisma.lectureLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map(toLectureView);
}
