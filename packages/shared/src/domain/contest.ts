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

/** 一支队伍的出战人数区间；同一场比赛内所有队伍必须取相同人数。 */
export const TEAM_SIZE_MIN = 3 as const;
export const TEAM_SIZE_MAX = 4 as const;

const teamMembersShape = z
  .array(participantSnapshotSchema)
  .min(TEAM_SIZE_MIN)
  .max(TEAM_SIZE_MAX);
export const teamMembersSchema = withJsonSafety(teamMembersShape);
export type TeamMembers = z.infer<typeof teamMembersSchema>;

/** 一场比赛的参赛队伍：HOME 为玩家队（恒 index 0），其余为 NPC 队。 */
const contestTeamShape = z
  .object({
    teamId: z.string().min(1),
    side: z.enum(['HOME', 'NPC']),
    userId: z.number().int().positive().nullable(),
    members: teamMembersSchema,
  })
  .strict();
export const contestTeamSchema = withJsonSafety(contestTeamShape);
export type ContestTeam = z.infer<typeof contestTeamSchema>;

/** 出题对决的某一侧队伍：只允许携带成员表，出场人数与对侧必须一致。 */
const duelSideInputShape = z.object({ members: teamMembersSchema }).strict();
export const duelSideInputSchema = withJsonSafety(duelSideInputShape);
export type DuelSideInput = z.infer<typeof duelSideInputSchema>;

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
    teamIndex: z.number().int().nonnegative(),
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
    teams: z.array(contestTeamSchema).min(2),
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

    const teamIds = new Set<string>();
    const rosterSize = input.teams[0]?.members.length;
    input.teams.forEach((team, teamIndex) => {
      const expectedSide = teamIndex === 0 ? 'HOME' : 'NPC';
      if (team.side !== expectedSide) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['teams', teamIndex, 'side'],
          message: `Team ${teamIndex} must use side ${expectedSide}`,
        });
      }
      if (team.members.length !== rosterSize) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['teams', teamIndex, 'members'],
          message: 'Every team must field the same number of members',
        });
      }
      if (teamIds.has(team.teamId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['teams', teamIndex, 'teamId'],
          message: 'teamId values must be unique',
        });
      }
      teamIds.add(team.teamId);
    });
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

/** 队员身份摘要，用于核对 participants 与 teams.flatMap(members) 的顺序一致性。 */
function memberIdentityKey(member: ParticipantSnapshot): string {
  return JSON.stringify([
    member.side,
    member.userId,
    member.studentId,
    member.displayName,
    member.mindset,
    member.focusCap,
    member.energyMax,
  ]);
}

interface TeamAggregate {
  totalScore: number;
  rankingPenaltyMin: number;
}

function isBetterTeamAttempt(
  candidate: TeamAttemptScore,
  incumbent: TeamAttemptScore,
): boolean {
  if (candidate.scoreAwarded !== incumbent.scoreAwarded)
    return candidate.scoreAwarded > incumbent.scoreAwarded;
  if (candidate.minutesUsed !== incumbent.minutesUsed)
    return candidate.minutesUsed < incumbent.minutesUsed;
  return candidate.memberIndex < incumbent.memberIndex;
}

interface TeamAttemptScore {
  scoreAwarded: number;
  minutesUsed: number;
  memberIndex: number;
  accepted: boolean;
}

/**
 * 队伍聚合：同一道题被多名队员作答时只取最优的一份成绩入账。
 * 排序口径（确定性可复放）：得分高者优 → 用时少者优 → 队内序号小者优。
 * 罚时沿用 ACM 口径：只有 AC 的成绩才累计用时。
 */
function aggregateTeam(timelines: readonly ParticipantTimeline[]): TeamAggregate {
  const best = new Map<string, TeamAttemptScore>();

  timelines.forEach((timeline, memberIndex) => {
    for (const attempt of timeline.attempts) {
      const candidate: TeamAttemptScore = {
        scoreAwarded: attempt.resolution.scoreAwarded,
        minutesUsed: attempt.minutesUsed,
        memberIndex,
        accepted: attempt.verdict === 'AC',
      };
      const incumbent = best.get(attempt.problemInstanceId);
      if (incumbent === undefined || isBetterTeamAttempt(candidate, incumbent)) {
        best.set(attempt.problemInstanceId, candidate);
      }
    }
  });

  let totalScore = 0;
  let rankingPenaltyMin = 0;
  for (const attempt of best.values()) {
    totalScore += attempt.scoreAwarded;
    if (attempt.accepted) rankingPenaltyMin += attempt.minutesUsed;
  }

  return { totalScore, rankingPenaltyMin };
}

const rankingReportShape = reportHeaderShape.extend({
  format: z.literal('RANKING'),
  inputSnapshot: rankingInputSchema,
  questions: z.array(questionSnapshotSchema).min(1),
  teams: z.array(contestTeamSchema).min(2),
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

  if (report.standings.length !== report.teams.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['standings'],
      message: 'Must contain exactly one standing per team',
    });
  }

  const flatMembers = report.teams.flatMap((team) => team.members);
  if (flatMembers.length !== report.participants.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['participants'],
      message: 'Must contain one timeline per team member',
    });
  } else {
    report.participants.forEach((timeline, index) => {
      if (memberIdentityKey(timeline.participant) !== memberIdentityKey(flatMembers[index]!)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['participants', index, 'participant'],
          message: 'Order must follow teams.flatMap(members)',
        });
      }
    });
  }

  let memberOffset = 0;
  const expectedTeamOrder = report.teams
    .map((team, teamIndex) => {
      const timelines = report.participants.slice(memberOffset, memberOffset + team.members.length);
      memberOffset += team.members.length;
      return { teamIndex, ...aggregateTeam(timelines) };
    })
    .sort(
      (left, right) =>
        right.totalScore - left.totalScore ||
        left.rankingPenaltyMin - right.rankingPenaltyMin ||
        left.teamIndex - right.teamIndex,
    );

  const seenTeams = new Set<number>();
  report.standings.forEach((standing, standingPosition) => {
    const expected = expectedTeamOrder[standingPosition];
    if (standing.teamIndex !== expected?.teamIndex) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['standings', standingPosition, 'teamIndex'],
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
    if (standing.teamIndex >= report.teams.length || seenTeams.has(standing.teamIndex)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['standings', standingPosition, 'teamIndex'],
        message: 'Team indexes must be unique and in range',
      });
    }
    seenTeams.add(standing.teamIndex);

    if (standing.totalScore !== expected?.totalScore) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['standings', standingPosition, 'totalScore'],
        message: 'Must equal the aggregated team score',
      });
    }
  });

  report.participants.forEach((timeline, participantIndex) => {
    const seenProblems = new Set<string>();
    timeline.attempts.forEach((attempt, attemptPosition) => {
      if (
        !instanceIds.has(attempt.problemInstanceId) ||
        seenProblems.has(attempt.problemInstanceId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['participants', participantIndex, 'attempts', attemptPosition, 'problemInstanceId'],
          message: 'Attempt problem instance IDs must be known and unique per participant',
        });
      }
      seenProblems.add(attempt.problemInstanceId);
    });
  });

  const playerStanding = report.standings.find((standing) => standing.teamIndex === 0);
  if (playerStanding === undefined || report.pass !== playerStanding.rank <= 8) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pass'],
      message: 'Must match the player team rank pass line',
    });
  }
});
export const rankingReportSchema = withJsonSafety(rankingReportWithChecks);
export type RankingReport = z.infer<typeof rankingReportSchema>;

export interface DuelRoundReport {
  roundNo: number;
  setterSide: 'HOME' | 'AWAY';
  answererSide: 'HOME' | 'AWAY';
  /** 出题方队内成员下标（0-based），按 §2N 局轮换规则取 k % N */
  setterMemberIndex: number;
  /** 答题方队内成员下标（0-based），取 (k + 1) % N */
  answererMemberIndex: number;
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
  /** 参赛**队伍**数（不是队员数）；玩家队、每支 NPC 队各计 1 */
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

const duelMemberIndex = z.number().int().nonnegative();

const duelInputShape = z
  .object({
    home: duelSideInputSchema,
    away: duelSideInputSchema,
    questions: z.array(questionSnapshotSchema).min(TEAM_SIZE_MIN * 2),
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
    if (input.home.members.length !== input.away.members.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['away', 'members'],
        message: 'Both sides must field the same number of members',
      });
    }
    input.home.members.forEach((member, memberIndexValue) => {
      if (member.side !== 'HOME') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['home', 'members', memberIndexValue, 'side'],
          message: 'Home members must use side HOME',
        });
      }
    });
    input.away.members.forEach((member, memberIndexValue) => {
      if (member.side !== 'AWAY') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['away', 'members', memberIndexValue, 'side'],
          message: 'Away members must use side AWAY',
        });
      }
    });

    const roundCount = input.home.members.length * 2;
    if (input.questions.length < roundCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questions'],
        message: `Must supply at least ${roundCount} questions for ${input.home.members.length} members per side`,
      });
    }
    input.questions.slice(roundCount).forEach((question, offset) => {
      if (question.source === 'PREMADE') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['questions', offset + roundCount, 'source'],
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
    setterMemberIndex: duelMemberIndex,
    answererMemberIndex: duelMemberIndex,
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
    rounds: z.array(duelRoundReportSchema).min(TEAM_SIZE_MIN * 2),
    scores: z
      .object({ home: z.number().int().nonnegative(), away: z.number().int().nonnegative() })
      .strict(),
    scoreAfterEachRound: z
      .array(
        z
          .object({ home: z.number().int().nonnegative(), away: z.number().int().nonnegative() })
          .strict(),
      )
      .min(TEAM_SIZE_MIN * 2),
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

    // 2N 局轮换：第 r 局（1-based）k = floor((r-1)/2)，出题方取队员 k，答题方取队员 (k+1) % N；
    // 奇数局 HOME 出题、偶数局 AWAY 出题。由此前 2N 局内每人恰好出题 1 次、答题 1 次。
    const memberCount = report.inputSnapshot.home.members.length;
    const roundCount = memberCount * 2;
    if (report.rounds.length < roundCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rounds'],
        message: `Must contain at least ${roundCount} rounds for ${memberCount} members per side`,
      });
    }

    const duties = new Set<string>();
    report.rounds.slice(0, roundCount).forEach((round, index) => {
      const group = Math.floor(index / 2);
      const expectedSetterSide = index % 2 === 0 ? 'HOME' : 'AWAY';
      const expectedSetterMember = group % memberCount;
      const expectedAnswererMember = (group + 1) % memberCount;

      if (round.setterSide !== expectedSetterSide) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rounds', index, 'setterSide'],
          message: 'Odd rounds must be set by HOME and even rounds by AWAY',
        });
      }
      if (round.setterMemberIndex !== expectedSetterMember) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rounds', index, 'setterMemberIndex'],
          message: 'Setter member must follow the 2N rotation',
        });
      }
      if (round.answererMemberIndex !== expectedAnswererMember) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rounds', index, 'answererMemberIndex'],
          message: 'Answerer member must follow the 2N rotation',
        });
      }

      duties.add(`setter:${round.setterSide}:${round.setterMemberIndex}`);
      duties.add(`answerer:${round.answererSide}:${round.answererMemberIndex}`);
    });

    if (report.rounds.length >= roundCount) {
      for (const side of ['HOME', 'AWAY'] as const) {
        for (let member = 0; member < memberCount; member += 1) {
          for (const duty of ['setter', 'answerer'] as const) {
            if (!duties.has(`${duty}:${side}:${member}`)) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['rounds'],
                message: `Every ${side} member must ${duty === 'setter' ? 'set' : 'answer'} exactly once`,
              });
            }
          }
        }
      }
    }
  });
export const duelReportSchema = withJsonSafety(duelReportShape);

export type ContestReportView = ContestReport;

/**
 * A server-authored, presentation-only sequence for the client battle viewer.
 * The report remains the source of truth; replay events never mutate game state.
 */
export type BattleReplayEvent =
  | {
      seq: number;
      type: 'BATTLE_START';
      durationMs: number;
      title: string;
      format: ContestFormat;
      homeName: string;
      awayName?: string;
    }
  | {
      seq: number;
      type: 'QUESTION_START';
      durationMs: number;
      participantName: string;
      questionIndex: number;
      problemInstanceId: string;
      dimension: string;
      score: number;
    }
  | {
      seq: number;
      type: 'SUBMISSION';
      durationMs: number;
      participantName: string;
      questionIndex: number;
      attemptNumber: number;
      verdict: ContestVerdict;
      submissionTimeMin: number;
      penaltyMin: number;
      extraEnergyCost: number;
      clockExhausted: boolean;
    }
  | {
      seq: number;
      type: 'QUESTION_RESULT';
      durationMs: number;
      participantName: string;
      questionIndex: number;
      verdict: Exclude<ContestVerdict, 'SKIP'> | 'SKIP';
      timeSpentMin: number;
      penaltyMin: number;
      scoreAwarded: number;
      totalScore: number;
      energyAfter: number;
      focusAfter: number;
      mindsetAfter: number;
      notes: string[];
    }
  | {
      seq: number;
      type: 'ROUND_START';
      durationMs: number;
      roundNo: number;
      setterSide: 'HOME' | 'AWAY';
      answererSide: 'HOME' | 'AWAY';
      setterName: string;
      questionInstanceId: string;
      participantName: string;
    }
  | {
      seq: number;
      type: 'ROUND_RESULT';
      durationMs: number;
      roundNo: number;
      setterSide: 'HOME' | 'AWAY';
      answererSide: 'HOME' | 'AWAY';
      setterName: string;
      answererName: string;
      solved: boolean;
      reason: Exclude<ContestVerdict, 'SKIP'>;
      timeSpentMin: number;
      penaltyMin: number;
      energyCost: number;
      scoreAwardedTo: 'HOME' | 'AWAY';
      scoreAwarded: number;
      homeScore: number;
      awayScore: number;
    }
  | {
      seq: number;
      type: 'TIEBREAK';
      durationMs: number;
      decidedBy: string;
      trail: string[];
    }
  | {
      seq: number;
      type: 'BATTLE_FINISH';
      durationMs: number;
      winnerSide?: DuelWinnerSide;
      rank?: number;
      totalScore?: number;
      participantCount?: number;
      pass?: boolean;
      homeScore?: number;
      awayScore?: number;
      rewards: RewardLine[];
      growth: GrowthDelta[];
    };

export interface BattleReplay {
  replayVersion: 1;
  recordId: string;
  format: ContestFormat;
  title: string;
  events: BattleReplayEvent[];
}
