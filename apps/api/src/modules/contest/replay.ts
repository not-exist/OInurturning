import type {
  BattleReplay,
  BattleReplayEvent,
  ContestReport,
  DuelReport,
  ParticipantSnapshot,
  RankingReport,
} from '@oinur/shared';

const INTRO_MS = 650;
const QUESTION_START_MS = 420;
const SUBMISSION_MS = 620;
const QUESTION_RESULT_MS = 720;
const ROUND_START_MS = 520;
const ROUND_RESULT_MS = 820;
const TIEBREAK_MS = 900;
const FINISH_MS = 500;

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
    durationMs: INTRO_MS,
    title,
    format: 'RANKING',
    homeName: playerMembers.length > 0 ? teamLabel(playerMembers) : '我方',
  });

  // 每位队员的独立得分累积（用于 QUESTION_RESULT.totalScore）。
  const memberScores = playerTimelines.map(() => 0);
  // 队伍总分用于 BATTLE_FINISH 的 fallback。
  let teamScore = 0;

  // 按题号轮转交错：每个 phase 内依次展示各队员对应该题的全部事件。
  for (let qi = 0; qi < maxQuestions; qi++) {
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
        durationMs: QUESTION_START_MS,
        participantName: memberName,
        memberIndex: mi,
        questionIndex: attempt.questionIndex,
        problemInstanceId: question.instanceId,
        dimension: question.dimension,
        score: question.score,
      });

      for (const submission of attempt.resolution.submissions) {
        events.push({
          seq: seq++,
          type: 'SUBMISSION',
          durationMs: SUBMISSION_MS,
          participantName: memberName,
          memberIndex: mi,
          questionIndex: attempt.questionIndex,
          attemptNumber: submission.attemptNumber,
          verdict: submission.verdict,
          submissionTimeMin: submission.submissionTimeMin,
          penaltyMin: submission.penaltyMin,
          extraEnergyCost: submission.extraEnergyCost,
          clockExhausted: submission.clockExhausted,
        });
      }

      memberScores[mi]! += attempt.resolution.scoreAwarded;
      teamScore += attempt.resolution.scoreAwarded;
      events.push({
        seq: seq++,
        type: 'QUESTION_RESULT',
        durationMs: QUESTION_RESULT_MS,
        participantName: memberName,
        memberIndex: mi,
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
    }
  }

  events.push({
    seq: seq++,
    type: 'BATTLE_FINISH',
    durationMs: FINISH_MS,
    rank: playerStanding?.rank,
    totalScore: playerStanding?.totalScore ?? teamScore,
    participantCount: report.teams.length,
    pass: report.pass,
    rewards: report.rewards,
    growth: report.growth,
  });

  return {
    replayVersion: 1,
    recordId,
    format: 'RANKING',
    title,
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
