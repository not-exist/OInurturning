import type {
  AttemptResolution,
  AttemptRng,
  ConditionalSolveHooks,
  EnergyCostInput,
  FocusAfterAttemptInput,
  HookContext,
  PartialOverride,
  QuestionAttempt,
  ResolveAttemptInput,
  SolveEstimateInput,
  SolveQuestionInput,
} from './models.js';

interface EffectiveHooks {
  timeKMul: number;
  acProbAdd: number;
  tleProbAdd: number;
  waPenaltyAdd: number;
  submitTimeAdd: number;
  energyCostAdd: number;
  energyPerSubmitAdd: number;
  noiseSigmaAdd: number;
  noiseSigmaMul: number;
  mindsetFailAdd: number;
  partialOverride?: PartialOverride;
  thinkWeightMul: number;
  probabilityAmplify: number;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function centered(amplitude: number, weight: number, gap: number): number {
  return 1 + amplitude * (sigmoid(weight * gap) - 0.5);
}

function hookIsActive(hook: ConditionalSolveHooks, context: HookContext | undefined): boolean {
  if (hook.condition === 'first_problem') return context?.isFirstProblem === true;
  if (hook.condition === 'anti_ak') return context?.isAntiAk === true;
  return true;
}

function effectiveHooks(
  hooks: readonly ConditionalSolveHooks[] | undefined,
  context: HookContext | undefined,
): EffectiveHooks {
  const result: EffectiveHooks = {
    timeKMul: 1,
    acProbAdd: 0,
    tleProbAdd: 0,
    waPenaltyAdd: 0,
    submitTimeAdd: 0,
    energyCostAdd: 0,
    energyPerSubmitAdd: 0,
    noiseSigmaAdd: 0,
    noiseSigmaMul: 1,
    mindsetFailAdd: 0,
    thinkWeightMul: 1,
    probabilityAmplify: 0,
  };

  for (const hook of hooks ?? []) {
    if (!hookIsActive(hook, context)) continue;
    result.timeKMul *= finite(hook.time_k_mul, 1);
    result.acProbAdd += finite(hook.ac_prob_add, 0);
    result.tleProbAdd += finite(hook.tle_prob_add, 0);
    result.waPenaltyAdd += finite(hook.wa_penalty_add, 0);
    result.submitTimeAdd += finite(hook.submit_time_add, 0);
    result.energyCostAdd += finite(hook.energy_cost_add, 0);
    result.energyPerSubmitAdd += finite(hook.energy_per_submit_add, 0);
    result.noiseSigmaAdd += finite(hook.noise_sigma_add, 0);
    result.noiseSigmaMul *= finite(hook.noise_sigma_mul, 1);
    result.mindsetFailAdd += finite(hook.mindset_fail_add, 0);
    result.thinkWeightMul *= finite(hook.think_weight_mul, 1);
    result.probabilityAmplify += finite(hook.prob_amplify, 0);
    if (hook.partial_override !== undefined) result.partialOverride = hook.partial_override;
  }

  return result;
}

function focusSpeed(focus: number, focusCap: number): number {
  if (focusCap <= 0) return 1;
  const ratio = clamp(finite(focus, 0) / focusCap, 0, 1);
  return 1 + 0.4 * ratio ** 0.8;
}

export function estimateSolveTime(input: SolveEstimateInput): number {
  const hooks = effectiveHooks(input.hooks, input.hookContext);
  const dimensionAbility = input.participant.abilities[input.question.dimension];
  const gapDimension = input.question.demand - dimensionAbility;
  const gapThinking = input.question.thought - input.participant.abilities.THINKING;
  const gapCoding = input.question.codeVolume - input.participant.abilities.CODING;
  const referenceTime = Math.max(0, finite(input.question.timeLimitMin, 0));

  const raw =
    (referenceTime *
      centered(1.6, 0.22, gapDimension) *
      centered(1.2, 0.25 * hooks.thinkWeightMul, gapThinking) *
      centered(0.7, 0.3, gapCoding) *
      hooks.timeKMul) /
    focusSpeed(input.focus, input.participant.focusCap);

  const minimum = Math.max(5, 0.35 * referenceTime);
  const maximum = Math.max(minimum, 2.5 * referenceTime);
  return clamp(finite(raw, minimum), minimum, maximum);
}

export function focusAfterAttempt(input: FocusAfterAttemptInput): number {
  const cap = Math.max(0, finite(input.focusCap, 0));
  const before = clamp(finite(input.focus, 0), 0, cap);
  const invested = Math.max(0, finite(input.investedMin, 0));
  const mindset = clamp(finite(input.mindset, 0), -10, 10);
  const mindsetFactor =
    mindset >= 1 ? 1 + 0.04 * mindset : mindset === 0 ? 0.7 : Math.max(0, 0.7 + 0.07 * mindset);
  const gain = Math.round(0.06 * invested * mindsetFactor);
  const anxietyLoss = mindset <= -6 ? invested : 0;

  return clamp(before + gain - anxietyLoss, 0, cap);
}

export function energyCost(input: EnergyCostInput): number {
  const hooks = effectiveHooks(input.hooks, input.hookContext);
  const codeGap = input.question.codeVolume - input.participant.abilities.CODING;
  const base = 3 + 0.1 * input.question.codeVolume;
  const required = Math.round(base * centered(1.4, 0.28, codeGap)) + hooks.energyCostAdd;
  const failures = 4 * Math.max(0, input.waCount ?? 0) + 2 * Math.max(0, input.tleJudgeCount ?? 0);
  const submissionCost = hooks.energyPerSubmitAdd * Math.max(0, input.submissions ?? 0);

  return Math.max(0, Math.round(required + failures + submissionCost));
}

function normalSample(rng: AttemptRng['noise']): number {
  const first = clamp(finite(rng(), 0.5), Number.EPSILON, 1 - Number.EPSILON);
  const second = clamp(finite(rng(), 0.5), 0, 1 - Number.EPSILON);
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function amplifyProbability(probability: number, amount: number): number {
  return probability + amount * (probability - 0.5);
}

export function resolveAttempt(input: ResolveAttemptInput, rng: AttemptRng): AttemptResolution {
  const hooks = effectiveHooks(input.hooks, input.hookContext);
  const attemptNumber = Math.max(1, Math.trunc(finite(input.attemptNumber, 1)));
  const remainingClock = Math.max(0, finite(input.remainingClockMin, 0));
  const rewriteMultiplier = attemptNumber === 1 ? 1 : 0.6;
  const noiseSigma = Math.max(0, (0.15 + hooks.noiseSigmaAdd) * hooks.noiseSigmaMul);
  const submissionTime = Math.max(
    0,
    rewriteMultiplier * Math.max(0, input.estimatedTimeMin) * Math.exp(noiseSigma * normalSample(rng.noise)) +
      hooks.submitTimeAdd,
  );

  if (submissionTime > remainingClock) {
    return {
      attemptNumber,
      verdict: 'UNFINISHED',
      submissionTimeMin: remainingClock,
      timeSpentMin: remainingClock,
      penaltyMin: 0,
      mindsetDelta: 0,
      extraEnergyCost: 0,
      clockExhausted: true,
    };
  }

  const tleProbability = clamp(amplifyProbability(0.02 + hooks.tleProbAdd, hooks.probabilityAmplify), 0, 0.6);
  const isTle = rng.judge() < tleProbability;
  let verdict: AttemptResolution['verdict'];

  if (isTle) {
    verdict = 'TLE';
  } else {
    const acProbability = clamp(
      amplifyProbability(
        finite(input.acProbability, 0) + hooks.acProbAdd + 0.08 * (attemptNumber - 1),
        hooks.probabilityAmplify,
      ),
      0.02,
      0.97,
    );
    verdict = rng.judge() < acProbability ? 'AC' : 'WA';
  }

  if (verdict === 'AC') {
    return {
      attemptNumber,
      verdict,
      submissionTimeMin: submissionTime,
      timeSpentMin: submissionTime,
      penaltyMin: 0,
      mindsetDelta: 2,
      extraEnergyCost: Math.max(0, hooks.energyPerSubmitAdd),
      clockExhausted: submissionTime >= remainingClock,
    };
  }

  const plannedPenalty = Math.max(0, 20 + hooks.waPenaltyAdd);
  const timeSpent = Math.min(remainingClock, submissionTime + plannedPenalty);
  const actualPenalty = Math.max(0, timeSpent - submissionTime);

  return {
    attemptNumber,
    verdict,
    submissionTimeMin: submissionTime,
    timeSpentMin: timeSpent,
    penaltyMin: actualPenalty,
    mindsetDelta: -4 + hooks.mindsetFailAdd,
    extraEnergyCost: Math.max(0, hooks.energyPerSubmitAdd) + (verdict === 'WA' ? 4 : 2),
    clockExhausted: timeSpent >= remainingClock,
  };
}

function baseAcProbability(input: SolveQuestionInput): number {
  const dimensionMargin = input.participant.abilities[input.question.dimension] - input.question.demand;
  const thinkingMargin = input.participant.abilities.THINKING - input.question.thought;
  return sigmoid(0.15 * (8 + dimensionMargin + thinkingMargin));
}

function partialScore(input: SolveQuestionInput, invested: number, estimated: number): number {
  const hooks = effectiveHooks(input.hooks, input.hookContext);
  const partialAllowed = hooks.partialOverride !== 'none' && hooks.partialOverride !== 'trap';
  if (!input.partialScores || !partialAllowed || invested < 0.5 * estimated) return 0;
  return Math.floor(Math.max(0, input.question.score) * 0.3);
}

export function solveQuestion(input: SolveQuestionInput, rng: AttemptRng): QuestionAttempt {
  const focusBefore = clamp(finite(input.focus, 0), 0, Math.max(0, input.participant.focusCap));
  const mindsetBefore = clamp(finite(input.mindset, 0), -10, 10);
  const availableEnergy = Math.max(0, finite(input.availableEnergy, 0));
  const estimatedTime = estimateSolveTime(input);
  const energyRequired = energyCost(input);

  if (availableEnergy < energyRequired) {
    return {
      questionIndex: input.question.index,
      verdict: 'SKIP',
      submissions: [],
      submissionCount: 0,
      waCount: 0,
      tleJudgeCount: 0,
      estimatedTimeMin: estimatedTime,
      timeSpentMin: 0,
      penaltyMin: 0,
      energyRequired,
      energyCost: 0,
      energyAfter: availableEnergy,
      scoreAwarded: 0,
      focusBefore,
      focusAfter: focusBefore,
      mindsetDelta: -3,
      mindsetAfter: clamp(mindsetBefore - 3, -10, 10),
      notes: ['SKIP_ENERGY'],
    };
  }

  const attempts: AttemptResolution[] = [];
  const notes: string[] = [];
  const clockLimit = Math.max(0, finite(input.remainingClockMin, 0));
  let timeSpent = 0;
  let penaltyMin = 0;
  let mindsetDelta = 0;
  let waCount = 0;
  let tleJudgeCount = 0;
  let submissionCount = 0;
  let verdict: QuestionAttempt['verdict'] = 'UNFINISHED';

  for (let attemptNumber = 1; timeSpent <= clockLimit; attemptNumber += 1) {
    const attempt = resolveAttempt(
      {
        attemptNumber,
        estimatedTimeMin: estimatedTime,
        remainingClockMin: Math.max(0, clockLimit - timeSpent),
        acProbability: baseAcProbability(input),
        hooks: input.hooks,
        hookContext: input.hookContext,
      },
      rng,
    );
    attempts.push(attempt);
    timeSpent = Math.min(clockLimit, timeSpent + attempt.timeSpentMin);
    penaltyMin += attempt.penaltyMin;
    mindsetDelta += attempt.mindsetDelta;

    if (attempt.verdict === 'UNFINISHED') break;

    submissionCount += 1;
    if (attempt.verdict === 'AC') {
      verdict = 'AC';
      break;
    }
    if (attempt.verdict === 'WA') {
      waCount += 1;
      notes.push('WA');
    } else {
      tleJudgeCount += 1;
      notes.push('TLE');
    }
    if (attempt.clockExhausted) break;
  }

  const spentEnergy = energyCost({
    ...input,
    waCount,
    tleJudgeCount,
    submissions: submissionCount,
  });
  const energyAfter = Math.max(0, availableEnergy - spentEnergy);
  const focusAfter = focusAfterAttempt({
    focus: focusBefore,
    focusCap: input.participant.focusCap,
    investedMin: timeSpent,
    mindset: mindsetBefore,
  });
  const scoreAwarded = verdict === 'AC' ? Math.max(0, input.question.score) : partialScore(input, timeSpent, estimatedTime);

  return {
    questionIndex: input.question.index,
    verdict,
    submissions: attempts,
    submissionCount,
    waCount,
    tleJudgeCount,
    estimatedTimeMin: estimatedTime,
    timeSpentMin: Math.min(clockLimit, timeSpent),
    penaltyMin: Math.min(timeSpent, penaltyMin),
    energyRequired,
    energyCost: spentEnergy,
    energyAfter,
    scoreAwarded,
    focusBefore,
    focusAfter,
    mindsetDelta,
    mindsetAfter: clamp(mindsetBefore + mindsetDelta, -10, 10),
    notes,
  };
}
