import type { ParticipantSnapshot, QuestionSnapshot } from '@oinur/shared';

export type RandomSource = () => number;

export interface AttemptRng {
  noise: RandomSource;
  judge: RandomSource;
}

export type HookCondition = 'first_problem' | 'anti_ak';
export type PartialOverride = 'none' | 'trap' | 'keep';

/** Snake-case names intentionally match the authoritative problem YAML hooks. */
export interface ConditionalSolveHooks {
  condition?: HookCondition;
  time_k_mul?: number;
  ac_prob_add?: number;
  tle_prob_add?: number;
  wa_penalty_add?: number;
  submit_time_add?: number;
  energy_cost_add?: number;
  energy_per_submit_add?: number;
  noise_sigma_add?: number;
  noise_sigma_mul?: number;
  mindset_fail_add?: number;
  partial_override?: PartialOverride;
  think_weight_mul?: number;
  prob_amplify?: number;
}

export interface HookContext {
  isFirstProblem?: boolean;
  isAntiAk?: boolean;
}

export interface SolveEstimateInput {
  participant: ParticipantSnapshot;
  question: QuestionSnapshot;
  focus: number;
  hooks?: readonly ConditionalSolveHooks[];
  hookContext?: HookContext;
}

export interface FocusAfterAttemptInput {
  focus: number;
  focusCap: number;
  investedMin: number;
  mindset: number;
}

export interface EnergyCostInput {
  participant: ParticipantSnapshot;
  question: QuestionSnapshot;
  waCount?: number;
  tleJudgeCount?: number;
  submissions?: number;
  hooks?: readonly ConditionalSolveHooks[];
  hookContext?: HookContext;
}

export interface ResolveAttemptInput {
  attemptNumber: number;
  estimatedTimeMin: number;
  remainingClockMin: number;
  acProbability: number;
  hooks?: readonly ConditionalSolveHooks[];
  hookContext?: HookContext;
}

export type AttemptVerdict = 'AC' | 'WA' | 'TLE' | 'UNFINISHED';

export interface AttemptResolution {
  attemptNumber: number;
  verdict: AttemptVerdict;
  submissionTimeMin: number;
  timeSpentMin: number;
  penaltyMin: number;
  mindsetDelta: number;
  extraEnergyCost: number;
  clockExhausted: boolean;
}

export interface SolveQuestionInput extends SolveEstimateInput {
  availableEnergy: number;
  remainingClockMin: number;
  mindset: number;
  partialScores?: boolean;
}

export type QuestionVerdict = 'AC' | 'SKIP' | 'UNFINISHED';

export interface QuestionAttempt {
  questionIndex: number;
  verdict: QuestionVerdict;
  submissions: AttemptResolution[];
  submissionCount: number;
  waCount: number;
  tleJudgeCount: number;
  estimatedTimeMin: number;
  timeSpentMin: number;
  penaltyMin: number;
  energyRequired: number;
  energyCost: number;
  energyAfter: number;
  scoreAwarded: number;
  focusBefore: number;
  focusAfter: number;
  mindsetDelta: number;
  mindsetAfter: number;
  notes: string[];
}
