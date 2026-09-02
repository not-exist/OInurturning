import { Prisma, type ProblemLibraryEntry } from '@prisma/client';
import { dayKey } from '../../lib/clock.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { getConfig } from '../../config/loader.js';
import { createRandomStream, deriveSeed } from '../contest/engine/rng.js';
import { aggregateMeta } from '../students/meta.js';
import { settle } from '../students/settle.js';
import { listProblems, type ProblemView } from './service.js';

export type ProblemDimension = 'DS' | 'DP' | 'MATH' | 'GRAPH' | 'GREEDY' | 'STRING';

export interface CreateProblemResult extends ProblemView {
  cost: number;
  staminaAfter: number;
}

const DIMENSION_FIELDS: Record<ProblemDimension, 'ds' | 'dp' | 'math' | 'graph' | 'greedy' | 'str'> = {
  DS: 'ds',
  DP: 'dp',
  MATH: 'math',
  GRAPH: 'graph',
  GREEDY: 'greedy',
  STRING: 'str',
};

const CONFIG_DIMENSIONS: Record<ProblemDimension, string> = {
  DS: 'ds',
  DP: 'dp',
  MATH: 'math',
  GRAPH: 'graph',
  GREEDY: 'greedy',
  STRING: 'string',
};

const SEVERITY_BASE = [40, 30, 18, 8, 3, 1] as const;
const DAILY_PROBLEM_LIMIT = 2;
const PROBLEM_CAPACITY = 120;

function config() {
  const value = getConfig();
  if (value === undefined) throw new Error('[problems] CONFIG 未加载');
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function problemRarity(quality: number): ProblemView['rarity'] {
  if (quality < 30) return 'GRAY';
  if (quality < 50) return 'YELLOW';
  if (quality < 70) return 'GREEN';
  if (quality < 85) return 'BLUE';
  if (quality < 95) return 'PURPLE';
  return 'RAINBOW';
}

function drawTrait(setting: number, random: () => number): string | null {
  const traits = Object.values(config().problemTraits).sort((left, right) => left.id.localeCompare(right.id));
  const probability = Math.min(0.05 + setting * 0.002, 0.35);
  if (random() >= probability || traits.length === 0) return null;
  const weighted = traits.map((trait) => {
    const severity = ['red', 'yellow', 'blue', 'purple', 'black', 'colorful'].indexOf(trait.severity);
    return { trait, weight: SEVERITY_BASE[Math.max(0, severity)]! * (1 + 0.006 * setting) ** Math.max(0, severity) };
  });
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll < 0) return entry.trait.id;
  }
  return weighted.at(-1)?.trait.id ?? null;
}

function toView(row: ProblemLibraryEntry): ProblemView {
  return {
    id: row.id,
    name: row.name,
    dominantDim: row.dominantDim as ProblemDimension,
    rarity: row.rarity.toUpperCase().replace('COLORFUL', 'RAINBOW') as ProblemView['rarity'],
    quality: row.quality,
    traitId: row.traitId,
    consumedAt: row.consumedAt?.toISOString() ?? null,
  };
}

export async function createProblem(
  userId: number,
  studentId: number,
  dimension: ProblemDimension,
  now: Date = new Date(),
): Promise<CreateProblemResult> {
  if (DIMENSION_FIELDS[dimension] === undefined) {
    throw new ApiError('VALIDATION_FAILED', { field: 'dimension' });
  }
  config();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const available = await tx.problemLibraryEntry.count({ where: { userId, consumedAt: null } });
    if (available >= PROBLEM_CAPACITY) {
      throw new ApiError('STATE_CONFLICT', { resource: 'problemLibrary', reason: 'capacity reached' });
    }
    await tx.$queryRaw`SELECT id FROM Student WHERE id = ${studentId} FOR UPDATE`;
    const current = await tx.student.findUnique({ where: { id: studentId }, include: { talents: true } });
    if (current === null || current.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', { resource: 'student', id: studentId });
    if (current.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id: studentId });
    const meta = aggregateMeta(current.talents.map((talent) => talent.talentId));
    const settled = settle(current, meta, now);
    if (settled.stamina < 1) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'stamina', need: 1 });
    const counters = record(current.counters);
    const counterKey = dayKey(now);
    const used = counters.problemCreationDailyKey === counterKey && typeof counters.problemCreationDaily === 'number'
      ? counters.problemCreationDaily
      : 0;
    if (used >= DAILY_PROBLEM_LIMIT) {
      throw new ApiError('STATE_CONFLICT', { resource: 'problemLibrary', reason: 'student daily creation limit reached' });
    }
    const ownedStudents = await tx.student.count({ where: { userId, status: 'ACTIVE' } });
    const cost = Math.round(20 * (1 + 0.15 * (ownedStudents - 1)));
    const paid = await tx.user.updateMany({
      where: { id: userId, money: { gte: cost } },
      data: { money: { decrement: cost } },
    });
    if (paid.count !== 1) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'money', need: cost });

    const random = createRandomStream(deriveSeed(userId, studentId, CONFIG_DIMENSIONS[dimension], counterKey, used), 'problem');
    const target = DIMENSION_FIELDS[dimension];
    const quality = Math.min(
      100,
      Math.max(
        0,
        Math.round(0.55 * settled.setting + 0.25 * settled[target] + 0.2 * settled.thinking + (random() * 17 - 8)),
      ),
    );
    const traitId = drawTrait(settled.setting, random);
    const updated = await tx.student.updateMany({
      where: { id: studentId, updatedAt: current.updatedAt },
      data: {
        stamina: settled.stamina - 1,
        energy: settled.energy,
        mindset: settled.mindset,
        lastSettledAt: settled.lastSettledAt,
        counters: {
          ...counters,
          problemCreationDaily: used + 1,
          problemCreationDailyKey: counterKey,
        } as Prisma.InputJsonValue,
      },
    });
    if (updated.count !== 1) throw new ApiError('STATE_CONFLICT', { studentId });
    const row = await tx.problemLibraryEntry.create({
      data: {
        userId,
        authorStudentId: studentId,
        name: `原创题·${dimension}·Q${quality}`,
        dominantDim: dimension,
        rarity: problemRarity(quality).toLowerCase().replace('rainbow', 'colorful'),
        quality,
        traitId,
        createdAt: now,
      },
    });
    return { ...toView(row), cost, staminaAfter: settled.stamina - 1 };
  });
}

export async function listProblemLibrary(userId: number): Promise<ProblemView[]> {
  return listProblems(userId);
}

export async function deleteProblem(userId: number, problemId: number): Promise<void> {
  const deleted = await prisma.problemLibraryEntry.deleteMany({
    where: { id: problemId, userId, consumedAt: null },
  });
  if (deleted.count === 1) return;
  const existing = await prisma.problemLibraryEntry.findUnique({ where: { id: problemId } });
  if (existing === null) throw new ApiError('NOT_FOUND', { resource: 'problem', id: problemId });
  if (existing.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'problem', id: problemId });
  throw new ApiError('STATE_CONFLICT', { resource: 'problem', id: problemId, reason: 'problem already consumed' });
}
