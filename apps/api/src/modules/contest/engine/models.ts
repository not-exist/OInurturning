import type {
  AttemptResolutionSnapshot,
  FrozenSolveHooks,
  ParticipantSnapshot,
  QuestionAttemptSnapshot,
  QuestionSnapshot,
} from '@oinur/shared';

export type RandomSource = () => number;

export interface AttemptRng {
  noise: RandomSource;
  judge: RandomSource;
}

export type HookCondition = 'first_problem' | 'anti_ak';
export type PartialOverride = 'none' | 'trap' | 'keep';

export type ConditionalSolveHooks = FrozenSolveHooks;

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

export type AttemptResolution = AttemptResolutionSnapshot;

export interface SolveQuestionInput extends SolveEstimateInput {
  availableEnergy: number;
  remainingClockMin: number;
  mindset: number;
  partialScores?: boolean;
}

export type QuestionVerdict = 'AC' | 'SKIP' | 'UNFINISHED';

export type QuestionAttempt = QuestionAttemptSnapshot;
