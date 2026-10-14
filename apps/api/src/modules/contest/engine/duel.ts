import {
  duelInputSchema,
  duelReportSchema,
  duelTiebreakInputSchema,
  rankingSeedSchema,
  type DuelInput,
  type DuelReport,
  type DuelRoundReport,
  type DuelTiebreakInput,
  type DuelWinnerSide,
  type ParticipantSnapshot,
  type QuestionSnapshot,
} from '@oinur/shared';
import { energyCost, solveQuestion } from './solve.js';
import { createRandomStream, deriveStreamSeed, RNG_VERSION } from './rng.js';
import { stableHash } from './report.js';

export const DUEL_ENGINE_VERSION = 'duel-v2' as const;

type DuelSide = 'HOME' | 'AWAY';

/** 精力/心态/答题数按 (side, memberIndex) 逐名成员独立结算，比分仍是每侧一个标量。 */
interface DuelState {
  energy: Record<DuelSide, number[]>;
  mindset: Record<DuelSide, number[]>;
  answers: Record<DuelSide, number[]>;
  scores: Record<DuelSide, number>;
}

interface RoundAssignment {
  setterSide: DuelSide;
  answererSide: DuelSide;
  setterMemberIndex: number;
  answererMemberIndex: number;
}

/**
 * 2N 局轮换（N = 每侧人数）：第 r 局（1-based）取 k = floor((r-1)/2)，
 * 出题方队员下标 = k，答题方队员下标 = (k+1) % N；奇数局 HOME 出题、偶数局 AWAY 出题。
 * 于是前 2N 局内每名成员恰好出题 1 次、答题 1 次。加赛局沿同一公式继续循环。
 */
function sideForRound(roundNo: number, memberCount: number): RoundAssignment {
  const group = Math.floor((roundNo - 1) / 2);
  const setterSide: DuelSide = roundNo % 2 === 1 ? 'HOME' : 'AWAY';
  return {
    setterSide,
    answererSide: setterSide === 'HOME' ? 'AWAY' : 'HOME',
    setterMemberIndex: group % memberCount,
    answererMemberIndex: (group + 1) % memberCount,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function questionHooks(question: QuestionSnapshot) {
  return question.traits.flatMap((trait) => trait.hooks);
}

function qualityOf(question: QuestionSnapshot): number {
  return question.quality ?? question.score;
}

function compareHigh(left: number, right: number): DuelWinnerSide {
  if (left > right) return 'HOME';
  if (left < right) return 'AWAY';
  return 'DRAW';
}

export function resolveTiebreak(input: DuelTiebreakInput): DuelWinnerSide {
  const validated = duelTiebreakInputSchema.parse(input);

  switch (validated.mode) {
    case 'ENERGY':
      return compareHigh(validated.homeEnergy, validated.awayEnergy);
    case 'QUALITY':
      return compareHigh(validated.homeQuality, validated.awayQuality);
    case 'FRIENDLY':
      return 'DRAW';
    case 'SUDDEN_DEATH': {
      const qualityWinner = compareHigh(validated.homeQuality, validated.awayQuality);
      if (qualityWinner !== 'DRAW') return qualityWinner;

      const penaltyWinner = compareHigh(validated.awayPenaltyMin, validated.homePenaltyMin);
      if (penaltyWinner !== 'DRAW') return penaltyWinner;
      return validated.seed % 2 === 0 ? 'HOME' : 'AWAY';
    }
  }
}

function updateScore(state: DuelState, side: DuelSide, points: number): void {
  state.scores[side] += points;
}

function runRound(
  input: DuelInput,
  state: DuelState,
  question: QuestionSnapshot,
  roundNo: number,
  seed: number,
): DuelRoundReport {
  const memberCount = input.home.members.length;
  const { setterSide, answererSide, setterMemberIndex, answererMemberIndex } = sideForRound(
    roundNo,
    memberCount,
  );
  const answerer = input[answererSide === 'HOME' ? 'home' : 'away'].members[answererMemberIndex]!;
  const hooks = questionHooks(question);
  const hookContext = {
    isFirstProblem: state.answers[answererSide][answererMemberIndex] === 0,
    isAntiAk: false,
  };
  const roundLimitMin = question.timeLimitMin * 1.25;
  const solverParticipant: ParticipantSnapshot = { ...answerer, focusCap: 0 };
  const energyBefore = state.energy[answererSide][answererMemberIndex]!;
  const energyRequired = energyCost({
    participant: solverParticipant,
    question,
    hooks,
    hookContext,
  });

  let solved = false;
  let forfeitEnergy = false;
  let submissions = 0;
  let timeSpentMin = 0;
  let penaltyMin = 0;
  let energySpent = 0;
  let mindsetDelta = 0;
  let reason: DuelRoundReport['reason'] = 'UNFINISHED';
  const notes: string[] = [];

  if (energyBefore < energyRequired) {
    forfeitEnergy = true;
    notes.push('FORFEIT_ENERGY');
  } else {
    const resolution = solveQuestion(
      {
        participant: solverParticipant,
        question,
        focus: 0,
        mindset: state.mindset[answererSide][answererMemberIndex]!,
        availableEnergy: energyBefore,
        remainingClockMin: roundLimitMin,
        partialScores: question.partialScores,
        hooks,
        hookContext,
      },
      {
        noise: createRandomStream(deriveStreamSeed(seed, `duel:round:${roundNo}`), 'noise'),
        judge: createRandomStream(deriveStreamSeed(seed, `duel:round:${roundNo}`), 'judge'),
      },
    );

    solved = resolution.verdict === 'AC';
    const lastSubmission = resolution.submissions.at(-1);
    reason =
      resolution.verdict === 'SKIP'
        ? 'UNFINISHED'
        : resolution.verdict === 'UNFINISHED' && lastSubmission?.verdict !== undefined
          ? lastSubmission.verdict
          : resolution.verdict;
    submissions = resolution.submissionCount;
    timeSpentMin = resolution.timeSpentMin;
    penaltyMin = resolution.penaltyMin;
    energySpent = resolution.energyCost;
    mindsetDelta = resolution.mindsetDelta;
    state.energy[answererSide][answererMemberIndex] = resolution.energyAfter;
    state.mindset[answererSide][answererMemberIndex] = resolution.mindsetAfter;
    state.answers[answererSide][answererMemberIndex] =
      state.answers[answererSide][answererMemberIndex]! + 1;
    notes.push(...resolution.notes);
  }

  const scoreAwardedTo: DuelSide = solved ? answererSide : setterSide;
  const scoreAwarded = solved || !input.qualityRuleOn ? 1 : 2;
  updateScore(state, scoreAwardedTo, scoreAwarded);

  return {
    roundNo,
    setterSide,
    answererSide,
    setterMemberIndex,
    answererMemberIndex,
    question,
    problemSource: question.source,
    roundLimitMin,
    answerer,
    solved,
    forfeitEnergy,
    submissions,
    timeSpentMin,
    penaltyMin,
    energyCost: energySpent,
    answererMindsetDelta: mindsetDelta,
    scoreAwarded,
    scoreAwardedTo,
    reason,
  };
}

function suddenDeathQuestion(
  input: DuelInput,
  setterSide: DuelSide,
  groupNo: number,
  questionOffset: number,
  regularRoundCount: number,
) {
  const supplied = input.questions[regularRoundCount + (groupNo - 1) * 2 + questionOffset];
  if (supplied !== undefined) return supplied;

  const source = input.questions[setterSide === 'HOME' ? 0 : 1]!;
  const generatedValues = { ...source };
  delete generatedValues.premadeEntryId;
  return {
    ...generatedValues,
    instanceId: `${source.instanceId}:sudden-death:${groupNo}`,
    index: source.index + 1000 + groupNo,
    source: 'GENERATED' as const,
  };
}

function tieInput(
  mode: NonNullable<DuelInput['tiebreak']>,
  state: DuelState,
  rounds: readonly DuelRoundReport[],
  seed: number,
): DuelTiebreakInput {
  return {
    mode,
    homeEnergy: sum(state.energy.HOME),
    awayEnergy: sum(state.energy.AWAY),
    homeQuality: rounds
      .filter((round) => round.setterSide === 'HOME')
      .reduce((total, round) => total + qualityOf(round.question), 0),
    awayQuality: rounds
      .filter((round) => round.setterSide === 'AWAY')
      .reduce((total, round) => total + qualityOf(round.question), 0),
    homePenaltyMin: rounds
      .filter((round) => round.answererSide === 'HOME')
      .reduce((total, round) => total + round.penaltyMin, 0),
    awayPenaltyMin: rounds
      .filter((round) => round.answererSide === 'AWAY')
      .reduce((total, round) => total + round.penaltyMin, 0),
    seed,
  };
}

function tiebreakTrail(input: DuelTiebreakInput, winner: DuelWinnerSide): string[] {
  const trail: string[] = [];
  if (input.mode === 'SUDDEN_DEATH') {
    if (input.homeQuality !== input.awayQuality) trail.push('quality');
    else if (input.homePenaltyMin !== input.awayPenaltyMin) trail.push('penalty');
    else trail.push(`seed-parity:${input.seed % 2}`);
  } else if (input.mode === 'ENERGY' && winner === 'DRAW') {
    trail.push('energy-tie', 'friendly');
  } else if (input.mode === 'QUALITY' && winner === 'DRAW') {
    trail.push('quality-tie', 'friendly');
  } else {
    trail.push(input.mode.toLowerCase());
  }
  return trail;
}

export function simulateDuel(input: DuelInput, seed: number): DuelReport {
  const validatedSeed = rankingSeedSchema.parse(seed);
  const validatedInput = duelInputSchema.parse(input);
  const memberCount = validatedInput.home.members.length;
  const regularRoundCount = memberCount * 2;

  const state: DuelState = {
    energy: {
      HOME: validatedInput.home.members.map((member) => member.energy ?? member.energyMax),
      AWAY: validatedInput.away.members.map((member) => member.energy ?? member.energyMax),
    },
    mindset: {
      HOME: validatedInput.home.members.map((member) => member.mindset),
      AWAY: validatedInput.away.members.map((member) => member.mindset),
    },
    answers: {
      HOME: validatedInput.home.members.map(() => 0),
      AWAY: validatedInput.away.members.map(() => 0),
    },
    scores: { HOME: 0, AWAY: 0 },
  };
  const rounds: DuelRoundReport[] = [];
  const usedQuestions = validatedInput.questions.slice(0, regularRoundCount);

  for (let roundNo = 1; roundNo <= regularRoundCount; roundNo += 1) {
    rounds.push(
      runRound(validatedInput, state, usedQuestions[roundNo - 1]!, roundNo, validatedSeed),
    );
  }

  const tiebreakMode = validatedInput.tiebreak ?? 'SUDDEN_DEATH';
  let winnerSide: DuelWinnerSide;
  let decidedBy: DuelReport['decidedBy'] = 'REGULAR';
  let trail: string[] | undefined;

  if (state.scores.HOME !== state.scores.AWAY) {
    winnerSide = state.scores.HOME > state.scores.AWAY ? 'HOME' : 'AWAY';
  } else if (tiebreakMode === 'SUDDEN_DEATH') {
    let suddenDeathWinner: DuelWinnerSide = 'DRAW';
    let suddenDeathGroup = 0;
    for (let groupNo = 1; groupNo <= 3 && suddenDeathWinner === 'DRAW'; groupNo += 1) {
      const homeQuestion = suddenDeathQuestion(
        validatedInput,
        'HOME',
        groupNo,
        0,
        regularRoundCount,
      );
      const awayQuestion = suddenDeathQuestion(
        validatedInput,
        'AWAY',
        groupNo,
        1,
        regularRoundCount,
      );
      const homeRound = runRound(
        validatedInput,
        state,
        homeQuestion,
        rounds.length + 1,
        validatedSeed,
      );
      const awayRound = runRound(
        validatedInput,
        state,
        awayQuestion,
        rounds.length + 2,
        validatedSeed,
      );
      rounds.push(homeRound, awayRound);
      suddenDeathGroup = groupNo;

      if (homeRound.solved !== awayRound.solved) {
        suddenDeathWinner = homeRound.solved ? 'AWAY' : 'HOME';
      }
    }

    const tiebreak = tieInput(tiebreakMode, state, rounds, validatedSeed);
    winnerSide = suddenDeathWinner === 'DRAW' ? resolveTiebreak(tiebreak) : suddenDeathWinner;
    decidedBy = 'SUDDEN_DEATH';
    trail =
      suddenDeathWinner === 'DRAW'
        ? tiebreakTrail(tiebreak, winnerSide)
        : [`sudden-death-group:${suddenDeathGroup}`, `winner:${suddenDeathWinner}`];
  } else {
    const tiebreak = tieInput(tiebreakMode, state, rounds, validatedSeed);
    winnerSide = resolveTiebreak(tiebreak);
    decidedBy = winnerSide === 'DRAW' ? 'FRIENDLY' : tiebreakMode;
    trail = tiebreakTrail(tiebreak, winnerSide);
  }

  const scoreAfterEachRound: { home: number; away: number }[] = [];
  let homeScore = 0;
  let awayScore = 0;
  for (const round of rounds) {
    if (round.scoreAwardedTo === 'HOME') homeScore += round.scoreAwarded;
    else awayScore += round.scoreAwarded;
    scoreAfterEachRound.push({ home: homeScore, away: awayScore });
  }

  return duelReportSchema.parse({
    reportVersion: 1,
    engineVersion: DUEL_ENGINE_VERSION,
    rngVersion: RNG_VERSION,
    seed: validatedSeed,
    snapshotHash: stableHash(validatedInput),
    createdAt: new Date(validatedSeed).toISOString(),
    rewards: [],
    growth: [],
    format: 'DUEL',
    inputSnapshot: validatedInput,
    rounds,
    scores: { home: state.scores.HOME, away: state.scores.AWAY },
    scoreAfterEachRound,
    tiebreak: tiebreakMode,
    decidedBy,
    ...(trail === undefined ? {} : { tiebreakTrail: trail }),
    qualityRuleOn: validatedInput.qualityRuleOn,
    winnerSide,
  });
}
