import type {
  BattleReplay,
  BattleReplayEvent,
  ContestReport,
  DuelReport,
  ParticipantSnapshot,
  RankingReport,
} from '@oinur/shared';
import { cloneQuestionSnapshot } from './engine/report.js';

const INTRO_MS = 650;
const QUESTION_START_MS = 420;
const SUBMISSION_MS = 620;
const QUESTION_RESULT_MS = 720;
const ROUND_START_MS = 520;
const ROUND_RESULT_MS = 820;
const TIEBREAK_MS = 900;
const FINISH_MS = 500;
const REPLAY_MS_PER_CONTEST_MINUTE = 55;
const NEXT_QUESTION_GAP_MS = 700;

/**
 * Converts the persisted authoritative report into a deterministic sequence of
 * presentation events. This function never simulates or mutates game state.
 */
export function buildBattleReplay(
  recordId: string,
  report: ContestReport,
  title: string,
): BattleReplay {
  return report.format === 'RANKING'
    ? buildRankingReplay(recordId, report, title)
    : buildDuelReplay(recordId, report, title);
}

/** 队伍展示名，例如 `4 人队：张三 / 李四 / 王五 / 赵六`。 */
function teamLabel(members: readonly ParticipantSnapshot[]): string {
  if (members.length === 0) return '空队';
  return `${members.length} 人队：${members.map((member) => member.displayName).join(' / ')}`;
}

function replaySortPriority(event: BattleReplayEvent): number {
  switch (event.type) {
    case 'BATTLE_START':
      return 0;
    case 'QUESTION_START':
      return 1;
    case 'SUBMISSION':
      return 2;
    case 'QUESTION_RESULT':
      return 3;
    case 'BATTLE_FINISH':
      return 4;
    case 'ROUND_START':
    case 'ROUND_RESULT':
    case 'TIEBREAK':
      return 5;
  }
}

function buildRankingReplay(recordId: string, report: RankingReport, title: string): BattleReplay {
  const events: BattleReplayEvent[] = [];
  let seq = 0;
  const playerMembers = report.teams[0]?.members ?? [];
  // participants 是 teams.flatMap(members) 的扁平时间线，前 N 条即玩家队成员。
  const playerTimelines = report.participants.slice(0, playerMembers.length);
  const playerStanding = report.standings.find((standing) => standing.teamIndex === 0);
  const questionById = new Map(report.questions.map((question) => [question.instanceId, question]));

  // 所有队员的最大答题数，决定 phase 数。
  const maxQuestions = Math.max(0, ...playerTimelines.map((tl) => tl.attempts.length));

  events.push({
    seq: seq++,
    type: 'BATTLE_START',
    timeMs: 0,
    durationMs: INTRO_MS,
    title,
    format: 'RANKING',
    homeName: playerMembers.length > 0 ? teamLabel(playerMembers) : '我方',
  });

  // 每位队员的独立得分累积（用于 QUESTION_RESULT.totalScore）。
  const memberScores = playerTimelines.map(() => 0);
  // 队伍总分用于 BATTLE_FINISH 的 fallback。
  let teamScore = 0;
  let phaseStartMs = INTRO_MS;

  // 并行时间线：每个 phase 内所有有该题的队员同时开始，提交/结算按各自用时落在同一时间轴。
  for (let qi = 0; qi < maxQuestions; qi++) {
    let phaseDurationMs = QUESTION_START_MS;

    for (let mi = 0; mi < playerTimelines.length; mi++) {
      const timeline = playerTimelines[mi]!;
      const attempt = timeline.attempts[qi];
      if (attempt === undefined) continue;

      const memberName = timeline.participant.displayName;
      const question = questionById.get(attempt.problemInstanceId);
      if (question === undefined) continue;

      events.push({
        seq: seq++,
        type: 'QUESTION_START',
        timeMs: phaseStartMs,
        durationMs: QUESTION_START_MS,
        participantName: memberName,
        memberIndex: mi,
        phaseIndex: qi,
        questionIndex: attempt.questionIndex,
        problemInstanceId: question.instanceId,
        dimension: question.dimension,
        score: question.score,
      });

      let elapsedInQuestionMin = 0;
      let lastSubmissionAtMs = phaseStartMs;
      for (const submission of attempt.resolution.submissions) {
        const submissionAtMs =
          phaseStartMs + Math.round((elapsedInQuestionMin + submission.submissionTimeMin) * REPLAY_MS_PER_CONTEST_MINUTE);
        events.push({
          seq: seq++,
          type: 'SUBMISSION',
          timeMs: submissionAtMs,
          durationMs: SUBMISSION_MS,
          participantName: memberName,
          memberIndex: mi,
          phaseIndex: qi,
          questionIndex: attempt.questionIndex,
          attemptNumber: submission.attemptNumber,
          verdict: submission.verdict,
          submissionTimeMin: submission.submissionTimeMin,
          penaltyMin: submission.penaltyMin,
          extraEnergyCost: submission.extraEnergyCost,
          clockExhausted: submission.clockExhausted,
        });
        lastSubmissionAtMs = submissionAtMs;
        elapsedInQuestionMin += submission.timeSpentMin;
        phaseDurationMs = Math.max(phaseDurationMs, submissionAtMs - phaseStartMs + SUBMISSION_MS);
      }

      const rawResultAtMs = phaseStartMs + Math.round(attempt.resolution.timeSpentMin * REPLAY_MS_PER_CONTEST_MINUTE);
      const resultAtMs = Math.max(
        rawResultAtMs,
        lastSubmissionAtMs + (attempt.resolution.submissions.length > 0 ? SUBMISSION_MS : QUESTION_START_MS),
      );
      memberScores[mi]! += attempt.resolution.scoreAwarded;
      teamScore += attempt.resolution.scoreAwarded;
      events.push({
        seq: seq++,
        type: 'QUESTION_RESULT',
        timeMs: resultAtMs,
        durationMs: QUESTION_RESULT_MS,
        participantName: memberName,
        memberIndex: mi,
        phaseIndex: qi,
        questionIndex: attempt.questionIndex,
        verdict: attempt.verdict,
        timeSpentMin: attempt.resolution.timeSpentMin,
        penaltyMin: attempt.resolution.penaltyMin,
        scoreAwarded: attempt.resolution.scoreAwarded,
        totalScore: memberScores[mi]!,
        energyAfter: attempt.resolution.energyAfter,
        focusAfter: attempt.resolution.focusAfter,
        mindsetAfter: attempt.resolution.mindsetAfter,
        notes: attempt.resolution.notes,
      });
      phaseDurationMs = Math.max(phaseDurationMs, resultAtMs - phaseStartMs + QUESTION_RESULT_MS);
    }

    phaseStartMs += phaseDurationMs + NEXT_QUESTION_GAP_MS;
  }

  events.push({
    seq: seq++,
    type: 'BATTLE_FINISH',
    timeMs: phaseStartMs,
    durationMs: FINISH_MS,
    rank: playerStanding?.rank,
    totalScore: playerStanding?.totalScore ?? teamScore,
    participantCount: report.teams.length,
    pass: report.pass,
    rewards: report.rewards,
    growth: report.growth,
  });

  events.sort((left, right) => {
    const leftTime = 'timeMs' in left ? (left.timeMs ?? 0) : 0;
    const rightTime = 'timeMs' in right ? (right.timeMs ?? 0) : 0;
    return leftTime - rightTime || replaySortPriority(left) - replaySortPriority(right) || left.seq - right.seq;
  });
  events.forEach((event, index) => {
    event.seq = index;
  });

  return {
    replayVersion: 1,
    recordId,
    format: 'RANKING',
    title,
    // 题目快照供前端「题目看板」展示难度与具体数值（旧战报无此字段，前端容错）。
    questions: report.questions.map(cloneQuestionSnapshot),
    events,
  };
}

function buildDuelReplay(recordId: string, report: DuelReport, title: string): BattleReplay {
  const events: BattleReplayEvent[] = [];
  let seq = 0;
  const homeMembers = report.inputSnapshot.home.members;
  const awayMembers = report.inputSnapshot.away.members;
  const scoreAfterEachRound = report.scoreAfterEachRound;

  events.push({
    seq: seq++,
    type: 'BATTLE_START',
    durationMs: INTRO_MS,
    title,
    format: 'DUEL',
    homeName: teamLabel(homeMembers),
    awayName: teamLabel(awayMembers),
  });

  report.rounds.forEach((round, index) => {
    const setterMembers = round.setterSide === 'HOME' ? homeMembers : awayMembers;
    const setterName = setterMembers[round.setterMemberIndex]?.displayName ?? '出题方';

    events.push({
      seq: seq++,
      type: 'ROUND_START',
      durationMs: ROUND_START_MS,
      roundNo: round.roundNo,
      setterSide: round.setterSide,
      answererSide: round.answererSide,
      setterName,
      questionInstanceId: round.question.instanceId,
      participantName: round.answerer.displayName,
    });

    const score = scoreAfterEachRound[index] ?? { home: 0, away: 0 };
    events.push({
      seq: seq++,
      type: 'ROUND_RESULT',
      durationMs: ROUND_RESULT_MS,
      roundNo: round.roundNo,
      setterSide: round.setterSide,
      answererSide: round.answererSide,
      setterName,
      answererName: round.answerer.displayName,
      solved: round.solved,
      reason: round.reason,
      timeSpentMin: round.timeSpentMin,
      penaltyMin: round.penaltyMin,
      energyCost: round.energyCost,
      scoreAwardedTo: round.scoreAwardedTo,
      scoreAwarded: round.scoreAwarded,
      homeScore: score.home,
      awayScore: score.away,
    });
  });

  if (report.decidedBy !== undefined && report.decidedBy !== 'REGULAR') {
    events.push({
      seq: seq++,
      type: 'TIEBREAK',
      durationMs: TIEBREAK_MS,
      decidedBy: report.decidedBy,
      trail: report.tiebreakTrail ?? [],
    });
  }

  events.push({
    seq: seq++,
    type: 'BATTLE_FINISH',
    durationMs: FINISH_MS,
    winnerSide: report.winnerSide,
    homeScore: report.scores.home,
    awayScore: report.scores.away,
    rewards: report.rewards,
    growth: report.growth,
  });

  return {
    replayVersion: 1,
    recordId,
    format: 'DUEL',
    title,
    events,
  };
}
