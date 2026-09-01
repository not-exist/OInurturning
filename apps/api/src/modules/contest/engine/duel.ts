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

export const DUEL_ENGINE_VERSION = 'duel-v1' as const;

type DuelSide = 'HOME' | 'AWAY';

interface DuelState {
  energy: Record<DuelSide, number>;
  mindset: Record<DuelSide, number>;
  answers: Record<DuelSide, number>;
  scores: Record<DuelSide, number>;
}

function sideForRound(roundNo: number): { setterSide: DuelSide; answererSide: DuelSide } {
  const setterSide: DuelSide = roundNo % 2 === 1 ? 'HOME' : 'AWAY';
  return { setterSide, answererSide: setterSide === 'HOME' ? 'AWAY' : 'HOME' };
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
  const { setterSide, answererSide } = sideForRound(roundNo);
  const answerer = input[answererSide === 'HOME' ? 'home' : 'away'];
  const hooks = questionHooks(question);
  const hookContext = {
    isFirstProblem: state.answers[answererSide] === 0,
    isAntiAk: false,
  };
  const roundLimitMin = question.timeLimitMin * 1.25;
  const solverParticipant: ParticipantSnapshot = { ...answerer, focusCap: 0 };
  const energyBefore = state.energy[answererSide];
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
        mindset: state.mindset[answererSide],
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
    state.energy[answererSide] = resolution.energyAfter;
    state.mindset[answererSide] = resolution.mindsetAfter;
    state.answers[answererSide] += 1;
    notes.push(...resolution.notes);
  }

  const scoreAwardedTo: DuelSide = solved ? answererSide : setterSide;
  const scoreAwarded = solved || !input.qualityRuleOn ? 1 : 2;
  updateScore(state, scoreAwardedTo, scoreAwarded);

  return {
    roundNo,
    setterSide,
    answererSide,
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
) {
  const supplied = input.questions[4 + (groupNo - 1) * 2 + questionOffset];
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
  questions: readonly QuestionSnapshot[],
  rounds: readonly DuelRoundReport[],
  seed: number,
): DuelTiebreakInput {
  return {
    mode,
    homeEnergy: state.energy.HOME,
    awayEnergy: state.energy.AWAY,
    homeQuality: questions
      .filter((_, index) => index % 2 === 0)
      .reduce((total, question) => total + qualityOf(question), 0),
    awayQuality: questions
      .filter((_, index) => index % 2 === 1)
      .reduce((total, question) => total + qualityOf(question), 0),
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
  if (validatedInput.home.side !== 'HOME' || validatedInput.away.side !== 'AWAY') {
    throw new Error('Duel home and away snapshots must use matching sides');
  }

  const state: DuelState = {
    energy: {
      HOME: validatedInput.home.energy ?? validatedInput.home.energyMax,
      AWAY: validatedInput.away.energy ?? validatedInput.away.energyMax,
    },
    mindset: { HOME: validatedInput.home.mindset, AWAY: validatedInput.away.mindset },
    answers: { HOME: 0, AWAY: 0 },
    scores: { HOME: 0, AWAY: 0 },
  };
  const rounds: DuelRoundReport[] = [];
  const usedQuestions = validatedInput.questions.slice(0, 4);

  for (let roundNo = 1; roundNo <= 4; roundNo += 1) {
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
      const homeQuestion = suddenDeathQuestion(validatedInput, 'HOME', groupNo, 0);
      const awayQuestion = suddenDeathQuestion(validatedInput, 'AWAY', groupNo, 1);
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

    const tiebreak = tieInput(
      tiebreakMode,
      state,
      rounds.map((round) => round.question),
      rounds,
      validatedSeed,
    );
    winnerSide = suddenDeathWinner === 'DRAW' ? resolveTiebreak(tiebreak) : suddenDeathWinner;
    decidedBy = 'SUDDEN_DEATH';
    trail =
      suddenDeathWinner === 'DRAW'
        ? tiebreakTrail(tiebreak, winnerSide)
        : [`sudden-death-group:${suddenDeathGroup}`, `winner:${suddenDeathWinner}`];
  } else {
    const tiebreak = tieInput(tiebreakMode, state, usedQuestions, rounds, validatedSeed);
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
