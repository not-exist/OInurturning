import { randomInt } from 'node:crypto';
import { Prisma, type RecruitPool, type Student } from '@prisma/client';
import { computeV, type StudentView } from '@oinur/shared';
import { getConfig } from '../../config/loader.js';
import { dayKey } from '../../lib/clock.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { mulberry32 } from '../../lib/rng.js';
import {
  TIER_TO_QUALITY,
  bucketTalents,
  generatePool,
  recruitPrice,
  refreshPrice,
  type CandidatePayload,
  type GenerateContext,
} from './recruit-gen.js';

/**
 * 招募服务（M1-R1/R2/R3）：
 * - 5 人候选池，24h 免费懒刷新（GET 时结算），手动刷新 round(100×1.5^k) 封顶 800、04:00 日界重置；
 * - 招募费生成时快照、招募时按当时在册数重算；钱变动全部走「条件 UPDATE + 事务」（TECH-DESIGN §5）；
 * - 池行在写事务内 SELECT … FOR UPDATE 串行化，防并发重复招募/重复刷新。
 */

/** 招募候选池容量（M1-R1：5 人；开局包预建池复用同一常量） */
export const POOL_SIZE = 5;
const HOUR_MS = 3_600_000;

function recruitmentCfg() {
  const config = getConfig();
  if (!config) throw new Error('[academy] CONFIG 未加载：importConfigs() 必须先于游戏逻辑执行');
  return config.economy.recruitment;
}

function talentBuckets() {
  const config = getConfig();
  if (!config) throw new Error('[academy] CONFIG 未加载：importConfigs() 必须先于游戏逻辑执行');
  return bucketTalents(config.talents);
}

/** 运行时种子：生成无需跨请求复现，取密码学随机；可复现性由注入 rng 的 gen 层保证 */
function newRng(): () => number {
  return mulberry32(randomInt(0, 2 ** 32));
}

type Querier = Pick<Prisma.TransactionClient, 'user' | 'student'>;

async function genCtx(tx: Querier, userId: number): Promise<GenerateContext> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { reputation: true },
  });
  const ownedStudents = await tx.student.count({ where: { userId, status: 'ACTIVE' } });
  return {
    reputation: user.reputation,
    ownedStudents,
    buckets: talentBuckets(),
    recruitment: recruitmentCfg(),
  };
}

function readCandidates(pool: RecruitPool): CandidatePayload[] {
  return pool.candidates as unknown as CandidatePayload[];
}

export interface PoolView {
  candidates: CandidatePayload[];
  generatedAt: string;
  refreshesToday: number;
  /** 当前再手动刷新一次的价格（04:00 日界重置后从 k=0 重新计） */
  refreshPrice: number;
}

function toPoolView(pool: RecruitPool, now: Date): PoolView {
  const k = pool.refreshDayKey === dayKey(now) ? pool.refreshesToday : 0;
  return {
    candidates: readCandidates(pool),
    generatedAt: pool.generatedAt.toISOString(),
    refreshesToday: k,
    refreshPrice: refreshPrice(recruitmentCfg().manual_refresh, k),
  };
}

/** 锁池行（写事务内串行化并发招募/刷新）；行不存在时不产生锁 */
async function lockPoolRow(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  await tx.$queryRaw`SELECT userId FROM RecruitPool WHERE userId = ${userId} FOR UPDATE`;
}

/**
 * GET 路径懒结算：无池则建池；距 generatedAt ≥ free_interval_hours 自动重生成；
 * 04:00 日界跨天后 refreshesToday 归零（clock.dayKey 口径）。
 */
export async function getPool(userId: number, now: Date = new Date()): Promise<PoolView> {
  const cfg = recruitmentCfg();
  const pool = await prisma.recruitPool.findUnique({ where: { userId } });

  if (!pool) {
    const ctx = await genCtx(prisma, userId);
    const candidates = generatePool(newRng(), ctx, POOL_SIZE);
    try {
      const created = await prisma.recruitPool.create({
        data: { userId, candidates: candidates as unknown as Prisma.InputJsonValue, generatedAt: now, refreshDayKey: dayKey(now) },
      });
      return toPoolView(created, now);
    } catch (e) {
      // 并发首建：唯一键兜底，重读胜出方的池
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await prisma.recruitPool.findUniqueOrThrow({ where: { userId } });
        return toPoolView(existing, now);
      }
      throw e;
    }
  }

  const stale = now.getTime() - pool.generatedAt.getTime() >= cfg.manual_refresh.free_interval_hours * HOUR_MS;
  const dayChanged = pool.refreshDayKey !== dayKey(now);
  if (!stale && !dayChanged) return toPoolView(pool, now);

  const candidates = stale ? generatePool(newRng(), await genCtx(prisma, userId), POOL_SIZE) : readCandidates(pool);
  const updated = await prisma.recruitPool.update({
    where: { userId },
    data: {
      candidates: candidates as unknown as Prisma.InputJsonValue,
      ...(stale ? { generatedAt: now } : {}),
      refreshesToday: 0,
      refreshDayKey: dayKey(now),
    },
  });
  return toPoolView(updated, now);
}

/** POST 手动刷新：价 round(100×1.5^k) 封顶 800；扣钱走条件 UPDATE，不足 → INSUFFICIENT_RESOURCE */
export async function refreshPool(userId: number, now: Date = new Date()): Promise<PoolView> {
  const cfg = recruitmentCfg();
  return prisma.$transaction(async (tx) => {
    await lockPoolRow(tx, userId);
    const pool = await tx.recruitPool.findUnique({ where: { userId } });
    if (!pool) throw new ApiError('NOT_FOUND', { resource: 'recruitPool' });

    const k = pool.refreshDayKey === dayKey(now) ? pool.refreshesToday : 0;
    const price = refreshPrice(cfg.manual_refresh, k);
    const paid = await tx.user.updateMany({
      where: { id: userId, money: { gte: price } },
      data: { money: { decrement: price } },
    });
    if (paid.count === 0) throw new ApiError('INSUFFICIENT_RESOURCE', { need: price, resource: 'money' });

    const candidates = generatePool(newRng(), await genCtx(tx, userId), POOL_SIZE);
    const updated = await tx.recruitPool.update({
      where: { userId },
      data: {
        candidates: candidates as unknown as Prisma.InputJsonValue,
        generatedAt: now,
        refreshesToday: k + 1,
        refreshDayKey: dayKey(now),
      },
    });
    return toPoolView(updated, now);
  });
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

/**
 * POST 招募：事务内重算价（在册数可能已变）→ 条件 UPDATE 扣钱 → 建 Student+StudentTalent → 池减员。
 * price 快照仅作展示；招募价以重算为准。
 */
export async function recruit(userId: number, tempId: string, now: Date = new Date()): Promise<StudentView> {
  const cfg = recruitmentCfg();
  return prisma.$transaction(async (tx) => {
    await lockPoolRow(tx, userId);
    const pool = await tx.recruitPool.findUnique({ where: { userId } });
    if (!pool) throw new ApiError('NOT_FOUND', { resource: 'recruitPool' });

    const candidates = readCandidates(pool);
    const candidate = candidates.find((c) => c.tempId === tempId);
    if (!candidate) throw new ApiError('NOT_FOUND', { resource: 'candidate', tempId });

    const owned = await tx.student.count({ where: { userId, status: 'ACTIVE' } });
    const price = recruitPrice(cfg, owned, TIER_TO_QUALITY[candidate.qualityTier]);
    const paid = await tx.user.updateMany({
      where: { id: userId, money: { gte: price } },
      data: { money: { decrement: price } },
    });
    if (paid.count === 0) throw new ApiError('INSUFFICIENT_RESOURCE', { need: price, resource: 'money' });

    const student = await tx.student.create({
      data: {
        userId,
        name: candidate.name,
        sex: candidate.sex,
        qualityTier: candidate.qualityTier,
        ds: candidate.attrs.ds, dp: candidate.attrs.dp, math: candidate.attrs.math,
        graph: candidate.attrs.graph, greedy: candidate.attrs.greedy, str: candidate.attrs.str,
        code: candidate.attrs.code, thinking: candidate.attrs.thinking, setting: candidate.attrs.setting,
        mindset: 2,
        focusCap: candidate.attrs.focusCap,
        energyMax: candidate.attrs.energyMax,
        energy: candidate.attrs.energyMax,
        staminaRegen: candidate.attrs.staminaRegen,
        lastSettledAt: now,
        recruitedAt: now,
      },
    });
    if (candidate.talents.length > 0) {
      await tx.studentTalent.createMany({
        data: candidate.talents.map((t) => ({
          studentId: student.id,
          talentId: t.talentId,
          acquiredVia: 'RECRUIT' as const,
        })),
      });
    }

    const remaining = candidates.filter((c) => c.tempId !== tempId);
    await tx.recruitPool.update({
      where: { userId },
      data: { candidates: remaining as unknown as Prisma.InputJsonValue },
    });

    return toStudentView(student, candidate.talents.map((t) => t.talentId));
  });
}
