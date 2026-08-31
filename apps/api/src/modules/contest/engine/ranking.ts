import {
  rankingInputSchema,
  rankingSeedSchema,
  type FrozenSolveHooks,
  type ParticipantAttempt,
  type ParticipantSnapshot,
  type ParticipantTimeline,
  type QuestionSnapshot,
  type RankingInput,
  type RankingReport,
  type RankingStanding,
} from '@oinur/shared';
import type { AttemptRng, HookContext, QuestionAttempt } from './models.js';
import { createRandomStream, deriveStreamSeed, RNG_VERSION } from './rng.js';
import { energyCost, estimateSolveTime, solveQuestion } from './solve.js';
import {
  ENGINE_VERSION,
  cloneQuestionSnapshot,
  isPassingRank,
  stableHash,
  validateRankingReport,
} from './report.js';

interface ParticipantResult {
  timeline: ParticipantTimeline;
  totalScore: number;
  rankingPenaltyMin: number;
}

function hooksFor(question: QuestionSnapshot): readonly FrozenSolveHooks[] {
  return question.traits.flatMap((trait) => trait.hooks);
}

function toTimelineAttempt(resolution: QuestionAttempt): ParticipantAttempt {
  return {
    questionIndex: resolution.questionIndex,
    verdict: resolution.verdict,
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

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareQuestionPriority(
  leftPosition: number,
  rightPosition: number,
  questions: readonly QuestionSnapshot[],
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
  const instanceDifference = compareCodeUnits(left.instanceId, right.instanceId);
  return instanceDifference === 0 ? leftPosition - rightPosition : instanceDifference;
}

function participantRng(seed: number, participantIndex: number): AttemptRng {
  const streamSeed = participantIndex === 0 ? seed : deriveStreamSeed(seed, `npc:${participantIndex - 1}`);
  return {
    noise: createRandomStream(streamSeed, 'noise'),
    judge: createRandomStream(streamSeed, 'judge'),
  };
}

function simulateParticipant(
  participant: ParticipantSnapshot,
  questions: readonly QuestionSnapshot[],
  durationMin: number,
  seed: number,
  participantIndex: number,
): ParticipantResult {
  const rng = participantRng(seed, participantIndex);
  const remaining = new Set(questions.map((_, position) => position));
  const accepted = new Set<number>();
  const attempts: ParticipantAttempt[] = [];
  let remainingClockMin = durationMin;
  let energy = participant.energyMax;
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
        const instanceDifference = compareCodeUnits(questions[left]!.instanceId, questions[right]!.instanceId);
        return instanceDifference === 0 ? left - right : instanceDifference;
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

export function simulateRanking(input: RankingInput, seed: number): RankingReport {
  const validatedSeed = rankingSeedSchema.parse(seed);
  const validatedInput = rankingInputSchema.parse(input);
  const questions = validatedInput.problems.map(cloneQuestionSnapshot);
  const participants = [validatedInput.student, ...(validatedInput.participants ?? [])];
  const results = participants.map((participant, participantIndex) =>
    simulateParticipant(participant, questions, validatedInput.durationMin, validatedSeed, participantIndex),
  );
  const standings = buildStandings(results);
  const playerRank = standings.find((standing) => standing.participantIndex === 0)?.rank ?? Number.POSITIVE_INFINITY;
  const report: RankingReport = {
    reportVersion: 1,
    engineVersion: ENGINE_VERSION,
    rngVersion: RNG_VERSION,
    seed: validatedSeed,
    snapshotHash: stableHash(validatedInput),
    createdAt: new Date(validatedSeed).toISOString(),
    ...(validatedInput.stageRef === undefined ? {} : { stageRef: { ...validatedInput.stageRef } }),
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
