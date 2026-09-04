import { z } from 'zod';
import { PROBLEM_SEVERITIES, PROBLEM_TIERS } from '../config/problems.js';
import { ABILITY_KEYS, DIMENSIONS } from '../enums.js';

export type ContestFormat = 'RANKING' | 'DUEL';
export type ContestSide = 'HOME' | 'AWAY' | 'NPC';
export type ContestVerdict = 'AC' | 'WA' | 'TLE' | 'SKIP' | 'UNFINISHED';
export type DuelWinnerSide = 'HOME' | 'AWAY' | 'DRAW';
export type TiebreakMode = 'SUDDEN_DEATH' | 'ENERGY' | 'QUALITY' | 'FRIENDLY';

const finiteNumber = z.number().finite();
const nonnegativeFinite = finiteNumber.nonnegative();

function rejectJsonSafetyIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function rejectNonJsonSafeValues(
  value: unknown,
  context: z.RefinementCtx,
  path: (string | number)[] = [],
  active = new WeakSet<object>(),
): void {
  if (value === null) return;

  switch (typeof value) {
    case 'undefined':
      rejectJsonSafetyIssue(context, path, 'Explicit undefined values are not JSON-safe');
      return;
    case 'number':
      if (!Number.isFinite(value))
        rejectJsonSafetyIssue(context, path, 'Non-finite numbers are not JSON-safe');
      return;
    case 'string':
    case 'boolean':
      return;
    case 'bigint':
    case 'function':
    case 'symbol':
      rejectJsonSafetyIssue(context, path, `${typeof value} values are not JSON-safe`);
      return;
    case 'object':
      break;
  }

  const object = value as object;
  if (active.has(object)) {
    rejectJsonSafetyIssue(context, path, 'Cyclic values are not JSON-safe');
    return;
  }
  active.add(object);

  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      rejectJsonSafetyIssue(context, path, 'Non-plain objects are not JSON-safe');
      active.delete(object);
      return;
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') {
        rejectJsonSafetyIssue(
          context,
          [...path, String(key)],
          'Symbol-keyed properties are not JSON-safe',
        );
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.enumerable !== true) {
        rejectJsonSafetyIssue(
          context,
          [...path, key],
          'Non-enumerable properties are not JSON-safe',
        );
      }
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
        rejectJsonSafetyIssue(context, [...path, key], 'Accessor properties are not JSON-safe');
        continue;
      }

      const entry = descriptor?.value;
      rejectNonJsonSafeValues(entry, context, [...path, key], active);
    }
    active.delete(object);
    return;
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') {
      rejectJsonSafetyIssue(
        context,
        [...path, String(key)],
        'Symbol-keyed array properties are not JSON-safe',
      );
      continue;
    }
    if (key === 'length') continue;

    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      rejectJsonSafetyIssue(
        context,
        [...path, key],
        'Arrays may only contain dense numeric own properties',
      );
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
      rejectJsonSafetyIssue(context, [...path, key], 'Accessor properties are not JSON-safe');
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      rejectJsonSafetyIssue(context, [...path, index], 'Sparse arrays are not JSON-safe');
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor?.get !== undefined || descriptor?.set !== undefined) continue;
    rejectNonJsonSafeValues(descriptor?.value, context, [...path, index], active);
  }

  active.delete(object);
}

function withJsonSafety<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value, context) => {
    rejectNonJsonSafeValues(value, context);
    return value;
  }, schema);
}

export const rankingSeedSchema = z.number().int().min(0).max(0xffffffff);

const contestStageRefShape = z
  .object({
    chapter: z.string().min(1),
    stageIndex: z.number().int().nonnegative(),
    ngPlusLayer: z.number().int().nonnegative(),
  })
  .strict();
export const contestStageRefSchema = withJsonSafety(contestStageRefShape);
export type ContestStageRef = z.infer<typeof contestStageRefSchema>;

export const hookConditionSchema = z.enum(['first_problem', 'anti_ak']);
export const partialOverrideSchema = z.enum(['none', 'trap', 'keep']);

/** Frozen snake-case hook payload consumed directly by the solving kernel. */
const frozenSolveHooksShape = z
  .object({
    condition: hookConditionSchema.optional(),
    time_k_mul: finiteNumber.optional(),
    ac_prob_add: finiteNumber.optional(),
    tle_prob_add: finiteNumber.optional(),
    wa_penalty_add: finiteNumber.optional(),
    submit_time_add: finiteNumber.optional(),
    energy_cost_add: finiteNumber.optional(),
    energy_per_submit_add: finiteNumber.optional(),
    noise_sigma_add: finiteNumber.optional(),
    noise_sigma_mul: finiteNumber.optional(),
    mindset_fail_add: finiteNumber.optional(),
    partial_override: partialOverrideSchema.optional(),
    think_weight_mul: finiteNumber.optional(),
    prob_amplify: finiteNumber.optional(),
  })
  .strict();
export const frozenSolveHooksSchema = withJsonSafety(frozenSolveHooksShape);
export type FrozenSolveHooks = z.infer<typeof frozenSolveHooksSchema>;

const questionTraitSnapshotShape = z
  .object({
    traitId: z.string().min(1),
    severity: z.enum(PROBLEM_SEVERITIES),
    hooks: z.array(frozenSolveHooksSchema),
  })
  .strict();
export const questionTraitSnapshotSchema = withJsonSafety(questionTraitSnapshotShape);
export type QuestionTraitSnapshot = z.infer<typeof questionTraitSnapshotSchema>;

/** Immutable question values and resolved trait hooks used by simulation and replay. */
const questionSnapshotShape = z
  .object({
    instanceId: z.string().min(1),
    index: z.number().int().nonnegative(),
    templateId: z.string().min(1).optional(),
    tier: z.enum(PROBLEM_TIERS).optional(),
    dimension: z.enum(DIMENSIONS),
    demand: nonnegativeFinite,
    thought: nonnegativeFinite,
    codeVolume: nonnegativeFinite,
    score: nonnegativeFinite,
    quality: nonnegativeFinite.optional(),
    timeLimitMin: finiteNumber.positive(),
    partialScores: z.boolean(),
    traits: z.array(questionTraitSnapshotSchema),
    source: z.enum(['GENERATED', 'PREMADE']),
    premadeEntryId: z.number().int().positive().optional(),
  })
  .strict();
export const questionSnapshotSchema = withJsonSafety(questionSnapshotShape);
export type QuestionSnapshot = z.infer<typeof questionSnapshotSchema>;

const abilityNumber = finiteNumber.min(1).max(100);
const abilityValues = Object.fromEntries(ABILITY_KEYS.map((key) => [key, abilityNumber])) as {
  [Key in (typeof ABILITY_KEYS)[number]]: typeof abilityNumber;
};

/** Immutable participant values captured at contest entry. Talents remain archival and inactive. */
const participantTraitSnapshotShape = z.object({ traitId: z.string().min(1) }).strict();
export const participantTraitSnapshotSchema = withJsonSafety(participantTraitSnapshotShape);
export type ParticipantTraitSnapshot = z.infer<typeof participantTraitSnapshotSchema>;

const participantSnapshotShape = z
  .object({
    side: z.enum(['HOME', 'AWAY', 'NPC']),
    userId: z.number().int().positive().nullable(),
    studentId: z.number().int().positive().nullable(),
    displayName: z.string().min(1),
    abilities: z.object(abilityValues).strict(),
    traits: z.array(participantTraitSnapshotSchema),
    mindset: finiteNumber.min(-10).max(10),
    focusCap: nonnegativeFinite,
    energy: nonnegativeFinite.optional(),
    energyMax: nonnegativeFinite,
  })
  .strict();
export const participantSnapshotSchema = withJsonSafety(participantSnapshotShape);
export type ParticipantSnapshot = z.infer<typeof participantSnapshotSchema>;

const attemptResolutionShape = z
  .object({
    attemptNumber: z.number().int().positive(),
    verdict: z.enum(['AC', 'WA', 'TLE', 'UNFINISHED']),
    submissionTimeMin: nonnegativeFinite,
    timeSpentMin: nonnegativeFinite,
    penaltyMin: nonnegativeFinite,
    mindsetDelta: finiteNumber,
    extraEnergyCost: nonnegativeFinite,
    clockExhausted: z.boolean(),
  })
  .strict();
export const attemptResolutionSchema = withJsonSafety(attemptResolutionShape);
export type AttemptResolutionSnapshot = z.infer<typeof attemptResolutionSchema>;

const questionAttemptShape = z
  .object({
    problemInstanceId: z.string().min(1),
    questionIndex: z.number().int().nonnegative(),
    verdict: z.enum(['AC', 'SKIP', 'UNFINISHED']),
    submissions: z.array(attemptResolutionSchema),
    submissionCount: z.number().int().nonnegative(),
    waCount: z.number().int().nonnegative(),
    tleJudgeCount: z.number().int().nonnegative(),
    estimatedTimeMin: nonnegativeFinite,
    timeSpentMin: nonnegativeFinite,
    penaltyMin: nonnegativeFinite,
    energyRequired: nonnegativeFinite,
    energyCost: nonnegativeFinite,
    energyAfter: nonnegativeFinite,
    scoreAwarded: nonnegativeFinite,
    focusBefore: nonnegativeFinite,
    focusAfter: nonnegativeFinite,
    mindsetDelta: finiteNumber,
    mindsetAfter: finiteNumber.min(-10).max(10),
    notes: z.array(z.string()),
  })
  .strict();
export const questionAttemptSchema = withJsonSafety(questionAttemptShape);
export type QuestionAttemptSnapshot = z.infer<typeof questionAttemptSchema>;

const participantAttemptShape = z
  .object({
    problemInstanceId: z.string().min(1),
    questionIndex: z.number().int().nonnegative(),
    verdict: z.enum(['AC', 'SKIP', 'UNFINISHED']),
    minutesUsed: nonnegativeFinite,
    penaltyMin: nonnegativeFinite,
    focusGain: finiteNumber,
    energyCost: nonnegativeFinite,
    mindsetDelta: finiteNumber,
    resolution: questionAttemptSchema,
  })
  .strict()
  .superRefine((attempt, context) => {
    const expected = {
      problemInstanceId: attempt.resolution.problemInstanceId,
      questionIndex: attempt.resolution.questionIndex,
      verdict: attempt.resolution.verdict,
      minutesUsed: attempt.resolution.timeSpentMin,
      penaltyMin: attempt.resolution.penaltyMin,
      focusGain: attempt.resolution.focusAfter - attempt.resolution.focusBefore,
      energyCost: attempt.resolution.energyCost,
      mindsetDelta: attempt.resolution.mindsetDelta,
    };

    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      if (attempt[key] !== expected[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Must match resolution.${key}`,
        });
      }
    }
  });
export const participantAttemptSchema = withJsonSafety(participantAttemptShape);
export type ParticipantAttempt = z.infer<typeof participantAttemptSchema>;

const participantTimelineShape = z
  .object({
    participant: participantSnapshotSchema,
    attempts: z.array(participantAttemptSchema),
    totalEnergySpent: nonnegativeFinite,
    finalMindset: finiteNumber.min(-10).max(10),
  })
  .strict()
  .superRefine((timeline, context) => {
    const energySpent = timeline.attempts.reduce((total, attempt) => total + attempt.energyCost, 0);
    if (timeline.totalEnergySpent !== energySpent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalEnergySpent'],
        message: 'Must equal summed attempt energy',
      });
    }

    const expectedMindset =
      timeline.attempts.at(-1)?.resolution.mindsetAfter ?? timeline.participant.mindset;
    if (timeline.finalMindset !== expectedMindset) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['finalMindset'],
        message: 'Must equal the final replay mindset',
      });
    }
  });
export const participantTimelineSchema = withJsonSafety(participantTimelineShape);
export type ParticipantTimeline = z.infer<typeof participantTimelineSchema>;

const rankingStandingShape = z
  .object({
    participantIndex: z.number().int().nonnegative(),
    totalScore: nonnegativeFinite,
    rank: z.number().int().positive(),
  })
  .strict();
export const rankingStandingSchema = withJsonSafety(rankingStandingShape);
export type RankingStanding = z.infer<typeof rankingStandingSchema>;

const rewardLineShape = z.discriminatedUnion('type', [
  z.object({ type: z.literal('first_clear_money'), amount: nonnegativeFinite }).strict(),
  z
    .object({
      type: z.literal('first_clear_item'),
      itemId: z.string().min(1),
      count: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('milestone_item'),
      itemId: z.string().min(1),
      count: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('rank_bonus_money'),
      rank: z.number().int().positive(),
      amount: nonnegativeFinite,
    })
    .strict(),
]);
export const rewardLineSchema = withJsonSafety(rewardLineShape);
export type RewardLine = z.infer<typeof rewardLineSchema>;

const growthDeltaShape = z
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
    sourceProblem: z.string().min(1).optional(),
  })
  .strict();
export const growthDeltaSchema = withJsonSafety(growthDeltaShape);
export type GrowthDelta = z.infer<typeof growthDeltaSchema>;

const npcPoolParamShape = z
  .object({
    size: z.number().int().nonnegative(),
    meanLevel: finiteNumber,
    spread: nonnegativeFinite,
  })
  .strict();
const npcPoolParamSchema = withJsonSafety(npcPoolParamShape);

const rankingInputShape = z
  .object({
    kind: z.enum(['story', 'custom']).optional(),
    stageRef: contestStageRefSchema.optional(),
    student: participantSnapshotSchema,
    participants: z.array(participantSnapshotSchema).optional(),
    problems: z.array(questionSnapshotSchema).min(1),
    durationMin: finiteNumber.positive(),
    npcPoolParam: npcPoolParamSchema.optional(),
    firstClearAvailable: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const instanceIds = new Set(input.problems.map((problem) => problem.instanceId));
    if (instanceIds.size !== input.problems.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['problems'],
        message: 'instanceId values must be unique',
      });
    }
  });
export const rankingInputSchema = withJsonSafety(rankingInputShape);
export type RankingInput = z.infer<typeof rankingInputSchema>;

const reportHeaderShape = z
  .object({
    reportVersion: z.literal(1),
    engineVersion: z.string().min(1),
    rngVersion: z.string().min(1),
    seed: rankingSeedSchema,
    snapshotHash: z.string().regex(/^[0-9a-f]{8}$/),
    createdAt: z.string().datetime(),
    stageRef: contestStageRefSchema.optional(),
    rewards: z.array(rewardLineSchema),
    growth: z.array(growthDeltaSchema),
  })
  .strict();
export const reportHeaderSchema = withJsonSafety(reportHeaderShape);
export type ReportHeader = z.infer<typeof reportHeaderSchema>;

const rankingReportShape = reportHeaderShape.extend({
  format: z.literal('RANKING'),
  inputSnapshot: rankingInputSchema,
  questions: z.array(questionSnapshotSchema).min(1),
  participants: z.array(participantTimelineSchema).min(1),
  standings: z.array(rankingStandingSchema).min(1),
  pass: z.boolean(),
});

const rankingReportWithChecks = rankingReportShape.superRefine((report, context) => {
  const instanceIds = new Set(report.questions.map((question) => question.instanceId));
  if (instanceIds.size !== report.questions.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['questions'],
      message: 'instanceId values must be unique',
    });
  }

  if (report.standings.length !== report.participants.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['standings'],
      message: 'Must contain exactly one standing per participant',
    });
  }

  const expectedParticipantOrder = report.participants
    .map((timeline, participantIndex) => ({
      participantIndex,
      totalScore: timeline.attempts.reduce(
        (total, attempt) => total + attempt.resolution.scoreAwarded,
        0,
      ),
      rankingPenaltyMin: timeline.attempts.reduce(
        (total, attempt) => total + (attempt.verdict === 'AC' ? attempt.minutesUsed : 0),
        0,
      ),
    }))
    .sort(
      (left, right) =>
        right.totalScore - left.totalScore ||
        left.rankingPenaltyMin - right.rankingPenaltyMin ||
        left.participantIndex - right.participantIndex,
    );

  const seenParticipants = new Set<number>();
  report.standings.forEach((standing, standingPosition) => {
    if (
      standing.participantIndex !== expectedParticipantOrder[standingPosition]?.participantIndex
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['standings', standingPosition, 'participantIndex'],
        message: 'Must match score, accepted-time, and stable-index ordering',
      });
    }
    if (standing.rank !== standingPosition + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['standings', standingPosition, 'rank'],
        message: 'Ranks must be contiguous and match standings order',
      });
    }
    if (
      standing.participantIndex >= report.participants.length ||
      seenParticipants.has(standing.participantIndex)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['standings', standingPosition, 'participantIndex'],
        message: 'Participant indexes must be unique and in range',
      });
    }
    seenParticipants.add(standing.participantIndex);

    const timeline = report.participants[standing.participantIndex];
    if (timeline !== undefined) {
      const expectedScore = timeline.attempts.reduce(
        (total, attempt) => total + attempt.resolution.scoreAwarded,
        0,
      );
      if (standing.totalScore !== expectedScore) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['standings', standingPosition, 'totalScore'],
          message: 'Must equal the participant replay score',
        });
      }
      const seenProblems = new Set<string>();
      timeline.attempts.forEach((attempt, attemptPosition) => {
        if (
          !instanceIds.has(attempt.problemInstanceId) ||
          seenProblems.has(attempt.problemInstanceId)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              'participants',
              standing.participantIndex,
              'attempts',
              attemptPosition,
              'problemInstanceId',
            ],
            message: 'Attempt problem instance IDs must be known and unique per participant',
          });
        }
        seenProblems.add(attempt.problemInstanceId);
      });
    }
  });

  const playerStanding = report.standings.find((standing) => standing.participantIndex === 0);
  if (playerStanding === undefined || report.pass !== playerStanding.rank <= 8) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pass'],
      message: 'Must match the player rank pass line',
    });
  }
});
export const rankingReportSchema = withJsonSafety(rankingReportWithChecks);
export type RankingReport = z.infer<typeof rankingReportSchema>;

export interface DuelRoundReport {
  roundNo: number;
  setterSide: 'HOME' | 'AWAY';
  answererSide: 'HOME' | 'AWAY';
  question: QuestionSnapshot;
  problemSource: 'GENERATED' | 'PREMADE';
  roundLimitMin: number;
  answerer: ParticipantSnapshot;
  solved: boolean;
  forfeitEnergy: boolean;
  submissions: number;
  timeSpentMin: number;
  penaltyMin: number;
  energyCost: number;
  answererMindsetDelta: number;
  scoreAwarded: number;
  scoreAwardedTo: 'HOME' | 'AWAY';
  reason: Exclude<ContestVerdict, 'SKIP'>;
}

export type DuelReport = ReportHeader & {
  format: 'DUEL';
  inputSnapshot: DuelInput;
  rounds: DuelRoundReport[];
  scores: { home: number; away: number };
  scoreAfterEachRound: { home: number; away: number }[];
  tiebreak?: TiebreakMode;
  decidedBy?: 'REGULAR' | 'SUDDEN_DEATH' | 'ENERGY' | 'QUALITY' | 'FRIENDLY';
  tiebreakTrail?: string[];
  qualityRuleOn: boolean;
  winnerSide: DuelWinnerSide;
};

export type ContestReport = RankingReport | DuelReport;

export interface RankingSummary {
  format: 'RANKING';
  rank: number;
  participantCount: number;
  totalScore: number;
  rewards: RewardLine[];
  growth: GrowthDelta[];
}

export interface DuelSummary {
  format: 'DUEL';
  winnerSide: DuelWinnerSide;
  homeScore: number;
  awayScore: number;
  rewards: RewardLine[];
  growth: GrowthDelta[];
}

export type ContestSummary = RankingSummary | DuelSummary;

export interface DuelTiebreakInput {
  mode: TiebreakMode;
  homeEnergy: number;
  awayEnergy: number;
  homeQuality: number;
  awayQuality: number;
  homePenaltyMin: number;
  awayPenaltyMin: number;
  seed: number;
}

const duelTiebreakInputShape = z
  .object({
    mode: z.enum(['SUDDEN_DEATH', 'ENERGY', 'QUALITY', 'FRIENDLY']),
    homeEnergy: nonnegativeFinite,
    awayEnergy: nonnegativeFinite,
    homeQuality: nonnegativeFinite,
    awayQuality: nonnegativeFinite,
    homePenaltyMin: nonnegativeFinite,
    awayPenaltyMin: nonnegativeFinite,
    seed: rankingSeedSchema,
  })
  .strict();
export const duelTiebreakInputSchema = withJsonSafety(duelTiebreakInputShape);

const duelInputShape = z
  .object({
    home: participantSnapshotSchema,
    away: participantSnapshotSchema,
    questions: z.array(questionSnapshotSchema).min(4),
    qualityRuleOn: z.boolean(),
    tiebreak: z.enum(['SUDDEN_DEATH', 'ENERGY', 'QUALITY', 'FRIENDLY']).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const instanceIds = new Set(input.questions.map((question) => question.instanceId));
    if (instanceIds.size !== input.questions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questions'],
        message: 'instanceId values must be unique',
      });
    }
    input.questions.slice(4).forEach((question, offset) => {
      if (question.source === 'PREMADE') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['questions', offset + 4, 'source'],
          message: 'Sudden-death questions must be generated',
        });
      }
    });
  });
export const duelInputSchema = withJsonSafety(duelInputShape);
export type DuelInput = z.infer<typeof duelInputSchema>;

const duelRoundReportShape = z
  .object({
    roundNo: z.number().int().positive(),
    setterSide: z.enum(['HOME', 'AWAY']),
    answererSide: z.enum(['HOME', 'AWAY']),
    question: questionSnapshotSchema,
    problemSource: z.enum(['GENERATED', 'PREMADE']),
    roundLimitMin: finiteNumber.positive(),
    answerer: participantSnapshotSchema,
    solved: z.boolean(),
    forfeitEnergy: z.boolean(),
    submissions: z.number().int().nonnegative(),
    timeSpentMin: nonnegativeFinite,
    penaltyMin: nonnegativeFinite,
    energyCost: nonnegativeFinite,
    answererMindsetDelta: finiteNumber,
    scoreAwarded: z.number().int().positive(),
    scoreAwardedTo: z.enum(['HOME', 'AWAY']),
    reason: z.enum(['AC', 'WA', 'TLE', 'UNFINISHED']),
  })
  .strict()
  .superRefine((round, context) => {
    if (round.setterSide === round.answererSide || round.answerer.side !== round.answererSide) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['answererSide'],
        message: 'Setter and answerer sides must differ',
      });
    }
    if (round.problemSource !== round.question.source) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['problemSource'],
        message: 'Must match question source',
      });
    }
    if (round.solved !== (round.reason === 'AC')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['solved'],
        message: 'Must match the round reason',
      });
    }
  });
export const duelRoundReportSchema = withJsonSafety(duelRoundReportShape);

const duelReportShape = reportHeaderShape
  .extend({
    format: z.literal('DUEL'),
    inputSnapshot: duelInputSchema,
    rounds: z.array(duelRoundReportSchema).min(4),
    scores: z
      .object({ home: z.number().int().nonnegative(), away: z.number().int().nonnegative() })
      .strict(),
    scoreAfterEachRound: z
      .array(
        z
          .object({ home: z.number().int().nonnegative(), away: z.number().int().nonnegative() })
          .strict(),
      )
      .min(4),
    tiebreak: z.enum(['SUDDEN_DEATH', 'ENERGY', 'QUALITY', 'FRIENDLY']).optional(),
    decidedBy: z.enum(['REGULAR', 'SUDDEN_DEATH', 'ENERGY', 'QUALITY', 'FRIENDLY']).optional(),
    tiebreakTrail: z.array(z.string()).optional(),
    qualityRuleOn: z.boolean(),
    winnerSide: z.enum(['HOME', 'AWAY', 'DRAW']),
  })
  .superRefine((report, context) => {
    if (report.scoreAfterEachRound.length !== report.rounds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scoreAfterEachRound'],
        message: 'Must contain one score per round',
      });
    }
    let home = 0;
    let away = 0;
    report.rounds.forEach((round, index) => {
      if (round.roundNo !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rounds', index, 'roundNo'],
          message: 'Round numbers must be contiguous',
        });
      }
      if (round.scoreAwardedTo === 'HOME') home += round.scoreAwarded;
      else away += round.scoreAwarded;
      const score = report.scoreAfterEachRound[index];
      if (score?.home !== home || score?.away !== away) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scoreAfterEachRound', index],
          message: 'Must match cumulative round scores',
        });
      }
    });
    if (report.scores.home !== home || report.scores.away !== away) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scores'],
        message: 'Must match final cumulative score',
      });
    }
  });
export const duelReportSchema = withJsonSafety(duelReportShape);

export type ContestReportView = ContestReport;
