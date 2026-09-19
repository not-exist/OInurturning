import {
  rankingInputSchema,
  rankingSeedSchema,
  type ContestTeam,
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

/** 同一道题在队内的候选成绩；AC 才计入罚时（沿用 ACM 口径）。 */
interface TeamAttemptCandidate {
  scoreAwarded: number;
  minutesUsed: number;
  memberIndex: number;
  accepted: boolean;
}

interface TeamResult {
  totalScore: number;
  rankingPenaltyMin: number;
}

function hooksFor(question: QuestionSnapshot): readonly FrozenSolveHooks[] {
  return question.traits.flatMap((trait) => trait.hooks);
}

function toTimelineAttempt(resolution: QuestionAttempt, startMin: number): ParticipantAttempt {
  return {
    problemInstanceId: resolution.problemInstanceId,
    questionIndex: resolution.questionIndex,
    verdict: resolution.verdict,
    startMin,
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

/** 一名队员的队内协作模拟状态（独立时钟、精力、专注、心态与选题集合）。 */
interface MemberSimulationState {
  participant: ParticipantSnapshot;
  rng: AttemptRng;
  clockMin: number;
  energy: number;
  focus: number;
  mindset: number;
  /** 该队员尚未尝试过的题目位置（选题时再剔除队内已通过的题）。 */
  remaining: Set<number>;
  attempts: ParticipantAttempt[];
  busy: {
    position: number;
    startMin: number;
    finishMin: number;
    resolution: QuestionAttempt;
  } | null;
}

/**
 * 队伍协作模拟（§3.7）：队员共享「队内已通过题集」——某题一旦被任何队员 AC，
 * 其他队员在之后的选题中不会再选择它（进行中的作答不受影响）。
 * 事件驱动：队员在各自时钟上并行攻题，完成时间最早者先结算并更新共享状态，
 * 同一时刻完成按队内成员序号结算，保证确定性。
 */
function simulateTeam(
  team: ContestTeam,
  questions: readonly QuestionSnapshot[],
  durationMin: number,
  seed: number,
  participantOffset: number,
): ParticipantTimeline[] {
  const members: MemberSimulationState[] = team.members.map((participant, memberIndex) => ({
    participant,
    rng: participantRng(seed, participantOffset + memberIndex),
    clockMin: 0,
    energy: participant.energy ?? participant.energyMax,
    focus: 0,
    mindset: participant.mindset,
    remaining: new Set(questions.map((_, position) => position)),
    attempts: [],
    busy: null,
  }));
  const teamPassed = new Set<number>();

  for (;;) {
    // 1) 空闲队员选题开题：候选 = 自己未尝试 且 队内未通过 且 精力可负担。
    for (const member of members) {
      if (member.busy !== null || member.clockMin >= durationMin) continue;

      const context = hookContext(member.attempts.length, teamPassed.size, questions.length);
      const available = [...member.remaining].filter((position) => {
        if (teamPassed.has(position)) return false;
        const question = questions[position]!;
        return (
          member.energy >=
          energyCost({ participant: member.participant, question, hooks: hooksFor(question), hookContext: context })
        );
      });

      if (available.length === 0) {
        // 剩余未通过题全部不可负担 → 逐题记 SKIP（不耗时），该队员随后离场。
        const skipped = [...member.remaining]
          .filter((position) => !teamPassed.has(position))
          .sort((left, right) => {
            const instanceDifference = compareCodeUnits(
              questions[left]!.instanceId,
              questions[right]!.instanceId,
            );
            return instanceDifference === 0 ? left - right : instanceDifference;
          });

        for (const position of skipped) {
          const question = questions[position]!;
          const resolution = solveQuestion(
            {
              participant: member.participant,
              question,
              availableEnergy: member.energy,
              remainingClockMin: durationMin - member.clockMin,
              focus: member.focus,
              mindset: member.mindset,
              partialScores: question.partialScores,
              hooks: hooksFor(question),
              hookContext: hookContext(member.attempts.length, teamPassed.size, questions.length),
            },
            member.rng,
          );
          member.attempts.push(toTimelineAttempt(resolution, member.clockMin));
          member.energy = resolution.energyAfter;
          member.focus = resolution.focusAfter;
          member.mindset = resolution.mindsetAfter;
          member.remaining.delete(position);
        }
        continue;
      }

      available.sort((left, right) =>
        compareQuestionPriority(left, right, questions, member.participant, member.focus, context),
      );
      const selectedPosition = available[0]!;
      const question = questions[selectedPosition]!;
      const resolution = solveQuestion(
        {
          participant: member.participant,
          question,
          availableEnergy: member.energy,
          remainingClockMin: durationMin - member.clockMin,
          focus: member.focus,
          mindset: member.mindset,
          partialScores: question.partialScores,
          hooks: hooksFor(question),
          hookContext: context,
        },
        member.rng,
      );

      member.busy = {
        position: selectedPosition,
        startMin: member.clockMin,
        finishMin: member.clockMin + resolution.timeSpentMin,
        resolution,
      };
    }

    // 2) 推进到最早的完成时刻并结算（同时刻按成员序号，确定性）。
    let nextFinishMin = Number.POSITIVE_INFINITY;
    for (const member of members) {
      if (member.busy !== null && member.busy.finishMin < nextFinishMin) {
        nextFinishMin = member.busy.finishMin;
      }
    }
    if (nextFinishMin === Number.POSITIVE_INFINITY) break;

    for (const member of members) {
      if (member.busy === null || member.busy.finishMin !== nextFinishMin) continue;
      const { position, startMin, resolution } = member.busy;
      member.attempts.push(toTimelineAttempt(resolution, startMin));
      member.remaining.delete(position);
      member.clockMin = nextFinishMin;
      member.energy = resolution.energyAfter;
      member.focus = resolution.focusAfter;
      member.mindset = resolution.mindsetAfter;
      if (resolution.verdict === 'AC') teamPassed.add(position);
      member.busy = null;
    }
  }

  return members.map((member) => ({
    participant: member.participant,
    attempts: member.attempts,
    totalEnergySpent: member.attempts.reduce((total, attempt) => total + attempt.energyCost, 0),
    finalMindset: member.mindset,
  }));
}

function isBetterTeamAttempt(
  candidate: TeamAttemptCandidate,
  incumbent: TeamAttemptCandidate,
): boolean {
  if (candidate.scoreAwarded !== incumbent.scoreAwarded)
    return candidate.scoreAwarded > incumbent.scoreAwarded;
  if (candidate.minutesUsed !== incumbent.minutesUsed)
    return candidate.minutesUsed < incumbent.minutesUsed;
  return candidate.memberIndex < incumbent.memberIndex;
}

/**
 * 队伍聚合：同一道题被多名队员作答时只把最优的一份成绩计入队伍总分，绝不重复计分。
 * 比较口径（确定性可复放）：得分高者优 → 用时少者优 → 队内序号小者优。
 */
function aggregateTeam(timelines: readonly ParticipantTimeline[]): TeamResult {
  const best = new Map<string, TeamAttemptCandidate>();

  timelines.forEach((timeline, memberIndex) => {
    for (const attempt of timeline.attempts) {
      const candidate: TeamAttemptCandidate = {
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

function buildStandings(results: readonly TeamResult[]): RankingStanding[] {
  return results
    .map((result, teamIndex) => ({
      teamIndex,
      totalScore: result.totalScore,
      rankingPenaltyMin: result.rankingPenaltyMin,
    }))
    .sort(
      (left, right) =>
        right.totalScore - left.totalScore ||
        left.rankingPenaltyMin - right.rankingPenaltyMin ||
        left.teamIndex - right.teamIndex,
    )
    .map(({ teamIndex, totalScore }, position) => ({
      teamIndex,
      totalScore,
      rank: position + 1,
    }));
}

export function simulateRanking(input: RankingInput, seed: number): RankingReport {
  const validatedSeed = rankingSeedSchema.parse(seed);
  const validatedInput = rankingInputSchema.parse(input);
  const questions = validatedInput.problems.map(cloneQuestionSnapshot);

  // 每支队伍内部协作选题（共享已通过题集）；玩家队与 NPC 队规则一致。
  let participantOffset = 0;
  const teamTimelines = validatedInput.teams.map((team) => {
    const timelines = simulateTeam(team, questions, validatedInput.durationMin, validatedSeed, participantOffset);
    participantOffset += team.members.length;
    return timelines;
  });
  const timelines = teamTimelines.flat();

  const teamResults = teamTimelines.map((slice) => aggregateTeam(slice));

  const standings = buildStandings(teamResults);
  const playerRank = standings.find((standing) => standing.teamIndex === 0)?.rank ?? Number.POSITIVE_INFINITY;
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
    inputSnapshot: validatedInput,
    questions,
    teams: validatedInput.teams,
    participants: timelines,
    standings,
    pass: isPassingRank(playerRank),
  };

  return validateRankingReport(report);
}
