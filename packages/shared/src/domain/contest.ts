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

export const rankingSeedSchema = z.number().int().min(0).max(0xffffffff);

export const contestStageRefSchema = z
  .object({
    chapter: z.string().min(1),
    stageIndex: z.number().int().nonnegative(),
    ngPlusLayer: z.number().int().nonnegative(),
  })
  .strict();
export type ContestStageRef = z.infer<typeof contestStageRefSchema>;

export const hookConditionSchema = z.enum(['first_problem', 'anti_ak']);
export const partialOverrideSchema = z.enum(['none', 'trap', 'keep']);

/** Frozen snake-case hook payload consumed directly by the solving kernel. */
export const frozenSolveHooksSchema = z
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
export type FrozenSolveHooks = z.infer<typeof frozenSolveHooksSchema>;

export const questionTraitSnapshotSchema = z
  .object({
    traitId: z.string().min(1),
    severity: z.enum(PROBLEM_SEVERITIES),
    hooks: z.array(frozenSolveHooksSchema),
  })
  .strict();
export type QuestionTraitSnapshot = z.infer<typeof questionTraitSnapshotSchema>;

/** Immutable question values and resolved trait hooks used by simulation and replay. */
export const questionSnapshotSchema = z
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
    timeLimitMin: finiteNumber.positive(),
    partialScores: z.boolean(),
    traits: z.array(questionTraitSnapshotSchema),
    source: z.enum(['GENERATED', 'PREMADE']),
    premadeEntryId: z.number().int().positive().optional(),
  })
  .strict();
export type QuestionSnapshot = z.infer<typeof questionSnapshotSchema>;

const abilityValues = Object.fromEntries(ABILITY_KEYS.map((key) => [key, finiteNumber])) as {
  [Key in (typeof ABILITY_KEYS)[number]]: typeof finiteNumber;
};

/** Immutable participant values captured at contest entry. Talents remain archival and inactive. */
export const participantSnapshotSchema = z
  .object({
    side: z.enum(['HOME', 'AWAY', 'NPC']),
    userId: z.number().int().positive().nullable(),
    studentId: z.number().int().positive().nullable(),
    displayName: z.string().min(1),
    abilities: z.object(abilityValues).strict(),
    mindset: finiteNumber.min(-10).max(10),
    focusCap: nonnegativeFinite,
    energyMax: nonnegativeFinite,
  })
  .strict();
export type ParticipantSnapshot = z.infer<typeof participantSnapshotSchema>;

export const attemptResolutionSchema = z
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
export type AttemptResolutionSnapshot = z.infer<typeof attemptResolutionSchema>;

export const questionAttemptSchema = z
  .object({
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
export type QuestionAttemptSnapshot = z.infer<typeof questionAttemptSchema>;

export const participantAttemptSchema = z
  .object({
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
        context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Must match resolution.${key}` });
      }
    }
  });
export type ParticipantAttempt = z.infer<typeof participantAttemptSchema>;

export const participantTimelineSchema = z
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

    const expectedMindset = timeline.attempts.at(-1)?.resolution.mindsetAfter ?? timeline.participant.mindset;
    if (timeline.finalMindset !== expectedMindset) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['finalMindset'],
        message: 'Must equal the final replay mindset',
      });
    }
  });
export type ParticipantTimeline = z.infer<typeof participantTimelineSchema>;

export const rankingStandingSchema = z
  .object({
    participantIndex: z.number().int().nonnegative(),
    totalScore: nonnegativeFinite,
    rank: z.number().int().positive(),
  })
  .strict();
export type RankingStanding = z.infer<typeof rankingStandingSchema>;

export const rewardLineSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('first_clear_money'), amount: nonnegativeFinite }).strict(),
  z.object({ type: z.literal('first_clear_item'), itemId: z.string().min(1), count: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('milestone_item'), itemId: z.string().min(1), count: z.number().int().positive() }).strict(),
  z
    .object({ type: z.literal('rank_bonus_money'), rank: z.number().int().positive(), amount: nonnegativeFinite })
    .strict(),
]);
export type RewardLine = z.infer<typeof rewardLineSchema>;

export const growthDeltaSchema = z
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
export type GrowthDelta = z.infer<typeof growthDeltaSchema>;

export const reportHeaderSchema = z
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
export type ReportHeader = z.infer<typeof reportHeaderSchema>;

const rankingReportShape = reportHeaderSchema.extend({
  format: z.literal('RANKING'),
  questions: z.array(questionSnapshotSchema).min(1),
  participants: z.array(participantTimelineSchema).min(1),
  standings: z.array(rankingStandingSchema).min(1),
  pass: z.boolean(),
});

export const rankingReportSchema = rankingReportShape.superRefine((report, context) => {
  const questionIndexes = new Set(report.questions.map((question) => question.index));
  const instanceIds = new Set(report.questions.map((question) => question.instanceId));
  if (instanceIds.size !== report.questions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['questions'], message: 'instanceId values must be unique' });
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
      totalScore: timeline.attempts.reduce((total, attempt) => total + attempt.resolution.scoreAwarded, 0),
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
    if (standing.participantIndex !== expectedParticipantOrder[standingPosition]?.participantIndex) {
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
    if (standing.participantIndex >= report.participants.length || seenParticipants.has(standing.participantIndex)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['standings', standingPosition, 'participantIndex'],
        message: 'Participant indexes must be unique and in range',
      });
    }
    seenParticipants.add(standing.participantIndex);

    const timeline = report.participants[standing.participantIndex];
    if (timeline !== undefined) {
      const expectedScore = timeline.attempts.reduce((total, attempt) => total + attempt.resolution.scoreAwarded, 0);
      if (standing.totalScore !== expectedScore) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['standings', standingPosition, 'totalScore'],
          message: 'Must equal the participant replay score',
        });
      }
      const seenQuestions = new Set<number>();
      timeline.attempts.forEach((attempt, attemptPosition) => {
        if (!questionIndexes.has(attempt.questionIndex) || seenQuestions.has(attempt.questionIndex)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['participants', standing.participantIndex, 'attempts', attemptPosition, 'questionIndex'],
            message: 'Attempt question indexes must be known and unique per participant',
          });
        }
        seenQuestions.add(attempt.questionIndex);
      });
    }
  });

  const playerStanding = report.standings.find((standing) => standing.participantIndex === 0);
  if (playerStanding === undefined || report.pass !== (playerStanding.rank <= 8)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['pass'], message: 'Must match the player rank pass line' });
  }
});
export type RankingReport = z.infer<typeof rankingReportSchema>;

export interface DuelRoundReport {
  roundNo: number;
  setterSide: 'HOME' | 'AWAY';
  question: QuestionSnapshot;
  answerer: ParticipantSnapshot;
  solved: boolean;
  scoreAwarded: number;
  reason: Exclude<ContestVerdict, 'SKIP'>;
}

export type DuelReport = ReportHeader & {
  format: 'DUEL';
  rounds: DuelRoundReport[];
  scores: { home: number; away: number };
  tiebreak?: TiebreakMode;
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

const npcPoolParamSchema = z
  .object({
    size: z.number().int().nonnegative(),
    meanLevel: finiteNumber,
    spread: nonnegativeFinite,
  })
  .strict();

export const rankingInputSchema = z
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
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['problems'], message: 'instanceId values must be unique' });
    }
  });
export type RankingInput = z.infer<typeof rankingInputSchema>;

export interface DuelInput {
  home: ParticipantSnapshot;
  away: ParticipantSnapshot;
  questions: QuestionSnapshot[];
  qualityRuleOn: boolean;
  tiebreak?: TiebreakMode;
}

export type ContestReportView = ContestReport;
