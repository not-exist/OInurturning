import type {
  ParticipantSnapshot,
  QuestionSnapshot,
  RankingInput,
  RankingStanding,
} from '@oinur/shared';
import type { ConditionalSolveHooks, HookContext, QuestionAttempt } from './models.js';
import { createRandomStream, deriveSeed, RNG_VERSION } from './rng.js';
import { energyCost, estimateSolveTime, solveQuestion } from './solve.js';
import {
  ENGINE_VERSION,
  cloneQuestionSnapshot,
  isPassingRank,
  stableHash,
  type DetailedParticipantAttempt,
  type DetailedParticipantTimeline,
  type DeterministicRankingReport,
  validateRankingReport,
} from './report.js';

interface ParticipantResult {
  timeline: DetailedParticipantTimeline;
  totalScore: number;
  rankingPenaltyMin: number;
}

interface RuntimeQuestion extends QuestionSnapshot {
  partialScores?: boolean;
}

const TRAIT_HOOKS: Readonly<Record<string, readonly ConditionalSolveHooks[]>> = {
  'wide-data': [{ partial_override: 'none', tle_prob_add: 0.05 }],
  'mod-longlong-curse': [{ wa_penalty_add: 5, ac_prob_add: -0.03 }],
  'strict-spj': [{ partial_override: 'none', noise_sigma_add: 0.05 }],
  'off-by-one-boundary': [{ ac_prob_add: -0.04, wa_penalty_add: 2 }],
  interactive: [{ submit_time_add: 10, energy_cost_add: 2 }],
  'card-constant': [{ tle_prob_add: 0.2 }],
  'greedy-counterexample': [{ ac_prob_add: -0.08 }],
  'partial-trap': [{ partial_override: 'trap' }],
  'construct-poison': [{ think_weight_mul: 1.5, ac_prob_add: -0.05 }],
  'anti-ak-shield': [{ condition: 'anti_ak', ac_prob_add: -0.15, tle_prob_add: 0.1 }],
  'force-online': [{ submit_time_add: 8, energy_per_submit_add: 1, partial_override: 'none' }],
  'precision-hell': [{ ac_prob_add: -0.12, wa_penalty_add: 5, mindset_fail_add: -2 }],
  'tight-clock': [{ tle_prob_add: 0.3, noise_sigma_mul: 1.3 }],
  'miracle-easy': [{ condition: 'first_problem', time_k_mul: 0.75, ac_prob_add: 0.25 }],
  'chaos-domain': [{ prob_amplify: 0.5, noise_sigma_add: 0.1 }],
};

function cloneParticipantSnapshot(participant: ParticipantSnapshot): ParticipantSnapshot {
  return {
    ...participant,
    abilities: { ...participant.abilities },
  };
}

function hooksFor(question: QuestionSnapshot): readonly ConditionalSolveHooks[] {
  return question.trait === undefined ? [] : (TRAIT_HOOKS[question.trait.traitId] ?? []);
}

function toTimelineAttempt(resolution: QuestionAttempt): DetailedParticipantAttempt {
  const verdict = resolution.verdict === 'UNFINISHED' ? 'TLE' : resolution.verdict;

  return {
    questionIndex: resolution.questionIndex,
    verdict,
    minutesUsed: resolution.timeSpentMin,
    penaltyMin: resolution.penaltyMin,
    focusGain: resolution.focusAfter - resolution.focusBefore,
    energyCost: resolution.energyCost,
    mindsetDelta: resolution.mindsetDelta,
    resolution,
  };
}

function hookContext(attemptCount: number, acCount: number, questionCount: number): HookContext {
  return {
    isFirstProblem: attemptCount === 0,
    isAntiAk: questionCount > 0 && acCount === questionCount - 1,
  };
}

function compareQuestionPriority(
  leftPosition: number,
  rightPosition: number,
  questions: readonly RuntimeQuestion[],
  participant: ParticipantSnapshot,
  focus: number,
  context: HookContext,
): number {
  const left = questions[leftPosition]!;
  const right = questions[rightPosition]!;
  const leftEstimate = estimateSolveTime({ participant, question: left, focus, hooks: hooksFor(left), hookContext: context });
  const rightEstimate = estimateSolveTime({
    participant,
    question: right,
    focus,
    hooks: hooksFor(right),
    hookContext: context,
  });
  const priorityDifference = right.score / rightEstimate - left.score / leftEstimate;

  if (priorityDifference !== 0) return priorityDifference;
  if (left.index !== right.index) return left.index - right.index;
  return leftPosition - rightPosition;
}

function simulateParticipant(
  participantInput: ParticipantSnapshot,
  questions: readonly RuntimeQuestion[],
  durationMin: number,
  seed: number,
  participantIndex: number,
): ParticipantResult {
  const participant = cloneParticipantSnapshot(participantInput);
  const participantSeed = deriveSeed(seed, 'participant', participantIndex);
  const rng = {
    noise: createRandomStream(participantSeed, 'noise'),
    judge: createRandomStream(participantSeed, 'judge'),
  };
  const remaining = new Set(questions.map((_, position) => position));
  const accepted = new Set<number>();
  const attempts: DetailedParticipantAttempt[] = [];
  let remainingClockMin = Math.max(0, durationMin);
  let energy = Math.max(0, participant.energyMax);
  let focus = 0;
  let mindset = participant.mindset;
  let totalScore = 0;
  let rankingPenaltyMin = 0;

  while (remainingClockMin > 0 && remaining.size > 0) {
    const context = hookContext(attempts.length, accepted.size, questions.length);
    const available = [...remaining].filter((position) => {
      const question = questions[position]!;
      return energy >= energyCost({ participant, question, hooks: hooksFor(question), hookContext: context });
    });

    if (available.length === 0) {
      const skipped = [...remaining].sort((left, right) => {
        const indexDifference = questions[left]!.index - questions[right]!.index;
        return indexDifference === 0 ? left - right : indexDifference;
      });

      for (const position of skipped) {
        const question = questions[position]!;
        const resolution = solveQuestion(
          {
            participant,
            question,
            availableEnergy: energy,
            remainingClockMin,
            focus,
            mindset,
            partialScores: question.partialScores,
            hooks: hooksFor(question),
            hookContext: hookContext(attempts.length, accepted.size, questions.length),
          },
          rng,
        );
        attempts.push(toTimelineAttempt(resolution));
        energy = resolution.energyAfter;
        focus = resolution.focusAfter;
        mindset = resolution.mindsetAfter;
        remaining.delete(position);
      }
      break;
    }

    available.sort((left, right) =>
      compareQuestionPriority(left, right, questions, participant, focus, context),
    );
    const selectedPosition = available[0]!;
    const question = questions[selectedPosition]!;
    const resolution = solveQuestion(
      {
        participant,
        question,
        availableEnergy: energy,
        remainingClockMin,
        focus,
        mindset,
        partialScores: question.partialScores,
        hooks: hooksFor(question),
        hookContext: context,
      },
      rng,
    );

    attempts.push(toTimelineAttempt(resolution));
    remaining.delete(selectedPosition);
    remainingClockMin = Math.max(0, remainingClockMin - resolution.timeSpentMin);
    energy = resolution.energyAfter;
    focus = resolution.focusAfter;
    mindset = resolution.mindsetAfter;
    totalScore += resolution.scoreAwarded;
    if (resolution.verdict === 'AC') {
      accepted.add(selectedPosition);
      rankingPenaltyMin += resolution.timeSpentMin;
    }
  }

  return {
    timeline: {
      participant,
      attempts,
      totalEnergySpent: attempts.reduce((total, attempt) => total + attempt.energyCost, 0),
      finalMindset: mindset,
    },
    totalScore,
    rankingPenaltyMin,
  };
}

function buildStandings(results: readonly ParticipantResult[]): RankingStanding[] {
  return results
    .map((result, participantIndex) => ({
      participantIndex,
      totalScore: result.totalScore,
      rankingPenaltyMin: result.rankingPenaltyMin,
    }))
    .sort(
      (left, right) =>
        right.totalScore - left.totalScore ||
        left.rankingPenaltyMin - right.rankingPenaltyMin ||
        left.participantIndex - right.participantIndex,
    )
    .map(({ participantIndex, totalScore }, position) => ({
      participantIndex,
      totalScore,
      rank: position + 1,
    }));
}

export function simulateRanking(input: RankingInput, seed: number): DeterministicRankingReport {
  const normalizedSeed = seed >>> 0;
  const questions = input.problems.map((question) => cloneQuestionSnapshot(question) as RuntimeQuestion);
  const participants = [input.student, ...(input.participants ?? [])];
  const results = participants.map((participant, participantIndex) =>
    simulateParticipant(participant, questions, input.durationMin, normalizedSeed, participantIndex),
  );
  const standings = buildStandings(results);
  const playerRank = standings.find((standing) => standing.participantIndex === 0)?.rank ?? Number.POSITIVE_INFINITY;
  const report: DeterministicRankingReport = {
    reportVersion: 1,
    engineVersion: ENGINE_VERSION,
    rngVersion: RNG_VERSION,
    seed: normalizedSeed,
    snapshotHash: stableHash(input),
    createdAt: new Date(normalizedSeed).toISOString(),
    ...(input.stageRef === undefined ? {} : { stageRef: { ...input.stageRef } }),
    rewards: [],
    growth: [],
    format: 'RANKING',
    questions,
    participants: results.map((result) => result.timeline),
    standings,
    pass: isPassingRank(playerRank),
  };

  return validateRankingReport(report);
}
