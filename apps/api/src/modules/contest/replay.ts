import type {
  BattleReplay,
  BattleReplayEvent,
  ContestReport,
  DuelReport,
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

function buildRankingReplay(recordId: string, report: RankingReport, title: string): BattleReplay {
  const events: BattleReplayEvent[] = [];
  let seq = 0;
  const player = report.participants[0];
  const playerName = player?.participant.displayName ?? '我方';
  const playerStanding = report.standings.find((standing) => standing.participantIndex === 0);
  const questionById = new Map(report.questions.map((question) => [question.instanceId, question]));
  let totalScore = 0;

  events.push({
    seq: seq++,
    type: 'BATTLE_START',
    durationMs: INTRO_MS,
    title,
    format: 'RANKING',
    homeName: playerName,
  });

  for (const attempt of player?.attempts ?? []) {
    const question = questionById.get(attempt.problemInstanceId);
    if (question === undefined) continue;

    events.push({
      seq: seq++,
      type: 'QUESTION_START',
      durationMs: QUESTION_START_MS,
      participantName: playerName,
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
        participantName: playerName,
        questionIndex: attempt.questionIndex,
        attemptNumber: submission.attemptNumber,
        verdict: submission.verdict,
        submissionTimeMin: submission.submissionTimeMin,
        penaltyMin: submission.penaltyMin,
        extraEnergyCost: submission.extraEnergyCost,
        clockExhausted: submission.clockExhausted,
      });
    }

    totalScore += attempt.resolution.scoreAwarded;
    events.push({
      seq: seq++,
      type: 'QUESTION_RESULT',
      durationMs: QUESTION_RESULT_MS,
      participantName: playerName,
      questionIndex: attempt.questionIndex,
      verdict: attempt.verdict,
      timeSpentMin: attempt.resolution.timeSpentMin,
      penaltyMin: attempt.resolution.penaltyMin,
      scoreAwarded: attempt.resolution.scoreAwarded,
      totalScore,
      energyAfter: attempt.resolution.energyAfter,
      focusAfter: attempt.resolution.focusAfter,
      mindsetAfter: attempt.resolution.mindsetAfter,
      notes: attempt.resolution.notes,
    });
  }

  events.push({
    seq: seq++,
    type: 'BATTLE_FINISH',
    durationMs: FINISH_MS,
    rank: playerStanding?.rank,
    totalScore: playerStanding?.totalScore ?? totalScore,
    participantCount: report.participants.length,
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
  const homeName = report.inputSnapshot.home.displayName;
  const awayName = report.inputSnapshot.away.displayName;
  const scoreAfterEachRound = report.scoreAfterEachRound;

  events.push({
    seq: seq++,
    type: 'BATTLE_START',
    durationMs: INTRO_MS,
    title,
    format: 'DUEL',
    homeName,
    awayName,
  });

  report.rounds.forEach((round, index) => {
    events.push({
      seq: seq++,
      type: 'ROUND_START',
      durationMs: ROUND_START_MS,
      roundNo: round.roundNo,
      setterSide: round.setterSide,
      answererSide: round.answererSide,
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
