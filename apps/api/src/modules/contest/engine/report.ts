import { z } from 'zod';
import type {
  ContestSummary,
  ParticipantAttempt,
  ParticipantTimeline,
  QuestionSnapshot,
  RankingReport,
} from '@oinur/shared';
import type { QuestionAttempt } from './models.js';
import { RNG_VERSION } from './rng.js';

export const ENGINE_VERSION = 'ranking-v1' as const;
export const PASS_RANK_MAX = 8 as const;

export interface DetailedParticipantAttempt extends ParticipantAttempt {
  resolution: QuestionAttempt;
}

export interface DetailedParticipantTimeline extends Omit<ParticipantTimeline, 'attempts'> {
  attempts: DetailedParticipantAttempt[];
}

export interface DeterministicRankingReport extends Omit<RankingReport, 'participants'> {
  engineVersion: typeof ENGINE_VERSION;
  rngVersion: typeof RNG_VERSION;
  snapshotHash: string;
  pass: boolean;
  participants: DetailedParticipantTimeline[];
}

const participantSnapshotSchema = z
  .object({
    side: z.enum(['HOME', 'AWAY', 'NPC']),
    userId: z.number().int().nullable(),
    studentId: z.number().int().nullable(),
    displayName: z.string(),
    abilities: z.record(z.string(), z.number().finite()),
    mindset: z.number().finite(),
    focusCap: z.number().finite(),
    energyMax: z.number().finite(),
  })
  .strict();

const questionSnapshotSchema = z
  .object({
    index: z.number().int(),
    dimension: z.enum(['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING']),
    demand: z.number().finite(),
    thought: z.number().finite(),
    codeVolume: z.number().finite(),
    score: z.number().finite(),
    timeLimitMin: z.number().finite(),
    trait: z
      .object({
        traitId: z.string(),
        severity: z.enum(['red', 'yellow', 'blue', 'purple', 'black', 'colorful']),
      })
      .strict()
      .optional(),
    source: z.enum(['GENERATED', 'PREMADE']),
    premadeEntryId: z.number().int().optional(),
  })
  .passthrough();

const attemptResolutionSchema = z
  .object({
    questionIndex: z.number().int(),
    verdict: z.enum(['AC', 'SKIP', 'UNFINISHED']),
    submissions: z.array(z.unknown()),
    submissionCount: z.number().int().nonnegative(),
    waCount: z.number().int().nonnegative(),
    tleJudgeCount: z.number().int().nonnegative(),
    estimatedTimeMin: z.number().finite().nonnegative(),
    timeSpentMin: z.number().finite().nonnegative(),
    penaltyMin: z.number().finite().nonnegative(),
    energyRequired: z.number().finite().nonnegative(),
    energyCost: z.number().finite().nonnegative(),
    energyAfter: z.number().finite().nonnegative(),
    scoreAwarded: z.number().finite().nonnegative(),
    focusBefore: z.number().finite().nonnegative(),
    focusAfter: z.number().finite().nonnegative(),
    mindsetDelta: z.number().finite(),
    mindsetAfter: z.number().finite(),
    notes: z.array(z.string()),
  })
  .strict();

const participantTimelineSchema = z
  .object({
    participant: participantSnapshotSchema,
    attempts: z.array(
      z
        .object({
          questionIndex: z.number().int(),
          verdict: z.enum(['AC', 'WA', 'TLE', 'SKIP']),
          minutesUsed: z.number().finite().nonnegative(),
          penaltyMin: z.number().finite().nonnegative().optional(),
          focusGain: z.number().finite(),
          energyCost: z.number().finite().nonnegative(),
          mindsetDelta: z.number().finite(),
          resolution: attemptResolutionSchema,
        })
        .strict(),
    ),
    totalEnergySpent: z.number().finite().nonnegative(),
    finalMindset: z.number().finite(),
  })
  .strict();

const rewardSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('first_clear_money'), amount: z.number().finite() }).strict(),
  z.object({ type: z.literal('first_clear_item'), itemId: z.string(), count: z.number().int() }).strict(),
  z.object({ type: z.literal('milestone_item'), itemId: z.string(), count: z.number().int() }).strict(),
  z.object({ type: z.literal('rank_bonus_money'), rank: z.number().int(), amount: z.number().finite() }).strict(),
]);

const growthSchema = z
  .object({
    attr: z.enum([
      'ds',
      'dp',
      'math',
      'graph',
      'greedy',
      'string',
      'thinking',
      'code',
      'focus_cap',
      'stamina_regen',
    ]),
    delta: z.literal(1),
    sourceProblem: z.string().optional(),
  })
  .strict();

export const rankingReportSchema = z
  .object({
    reportVersion: z.literal(1),
    engineVersion: z.literal(ENGINE_VERSION),
    rngVersion: z.literal(RNG_VERSION),
    seed: z.number().int().nonnegative().max(0xffffffff),
    snapshotHash: z.string().regex(/^[0-9a-f]{8}$/),
    createdAt: z.string().datetime(),
    stageRef: z
      .object({
        chapter: z.string(),
        stageIndex: z.number().int(),
        ngPlusLayer: z.number().int(),
      })
      .strict()
      .optional(),
    rewards: z.array(rewardSchema),
    growth: z.array(growthSchema),
    format: z.literal('RANKING'),
    questions: z.array(questionSnapshotSchema),
    participants: z.array(participantTimelineSchema),
    standings: z.array(
      z
        .object({
          participantIndex: z.number().int().nonnegative(),
          totalScore: z.number().finite().nonnegative(),
          rank: z.number().int().positive(),
        })
        .strict(),
    ),
    pass: z.boolean(),
  })
  .strict();

function encodeStable(value: unknown, active: WeakSet<object>, inArray: boolean): string | undefined {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'undefined':
    case 'function':
    case 'symbol':
      return inArray ? 'null' : undefined;
    case 'bigint':
      throw new TypeError('Cannot serialize bigint values');
    case 'object':
      break;
  }

  const object = value as object;
  if (active.has(object)) throw new TypeError('Cannot serialize cyclic values');
  active.add(object);

  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => encodeStable(entry, active, true) ?? 'null').join(',')}]`;
  } else {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .flatMap((key) => {
        const encoded = encodeStable(record[key], active, false);
        return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
      });
    result = `{${entries.join(',')}}`;
  }

  active.delete(object);
  return result;
}

export function stableSerialize(value: unknown): string {
  const encoded = encodeStable(value, new WeakSet<object>(), false);
  if (encoded === undefined) throw new TypeError('Cannot serialize an undefined root value');
  return encoded;
}

export function stableHash(value: unknown): string {
  const serialized = stableSerialize(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function validateRankingReport(report: DeterministicRankingReport): DeterministicRankingReport {
  rankingReportSchema.parse(report);
  return report;
}

export function serializeRankingReport(report: DeterministicRankingReport): string {
  return stableSerialize(validateRankingReport(report));
}

export function isPassingRank(rank: number): boolean {
  return Number.isInteger(rank) && rank >= 1 && rank <= PASS_RANK_MAX;
}

export function buildContestSummary(report: RankingReport): ContestSummary {
  const playerStanding = report.standings.find((standing) => standing.participantIndex === 0);
  if (playerStanding === undefined) throw new Error('Ranking report is missing the player standing');

  return {
    format: 'RANKING',
    rank: playerStanding.rank,
    participantCount: report.participants.length,
    totalScore: playerStanding.totalScore,
    rewards: report.rewards.map((reward) => ({ ...reward })),
    growth: report.growth.map((delta) => ({ ...delta })),
  };
}

export function cloneQuestionSnapshot(question: QuestionSnapshot): QuestionSnapshot {
  return {
    ...question,
    ...(question.trait === undefined ? {} : { trait: { ...question.trait } }),
  };
}
