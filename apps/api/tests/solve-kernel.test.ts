import { describe, expect, it } from 'vitest';
import type { ParticipantSnapshot, QuestionSnapshot } from '@oinur/shared';
import { createRandomStream } from '../src/modules/contest/engine/rng.js';
import {
  energyCost,
  estimateSolveTime,
  focusAfterAttempt,
  resolveAttempt,
  solveQuestion,
} from '../src/modules/contest/engine/solve.js';
import type {
  AttemptRng,
  ConditionalSolveHooks,
  SolveQuestionInput,
} from '../src/modules/contest/engine/models.js';

const participant: ParticipantSnapshot = {
  side: 'HOME',
  userId: 1,
  studentId: 2,
  displayName: 'Ada',
  abilities: {
    DS: 50,
    DP: 50,
    MATH: 50,
    GRAPH: 50,
    GREEDY: 50,
    STRING: 50,
    CODING: 50,
    THINKING: 50,
    PROBLEM: 50,
  },
  traits: [],
  mindset: 0,
  focusCap: 50,
  energyMax: 100,
};

const question: QuestionSnapshot = {
  instanceId: 'kernel#0',
  index: 0,
  dimension: 'DS',
  demand: 50,
  thought: 50,
  codeVolume: 50,
  score: 100,
  timeLimitMin: 90,
  partialScores: false,
  traits: [],
  source: 'GENERATED',
};

function values(sequence: readonly number[]): () => number {
  let index = 0;
  return () => sequence[Math.min(index++, sequence.length - 1)]!;
}

function zeroNoise(): () => number {
  let index = 0;
  return () => [0.5, 0.25][index++ % 2]!;
}

function controlledRng(judge: readonly number[]): AttemptRng {
  return { noise: zeroNoise(), judge: values(judge) };
}

function recordingRng(judge: readonly number[]): { rng: AttemptRng; draws: string[] } {
  const draws: string[] = [];
  const noise = zeroNoise();
  const judgeValues = values(judge);

  return {
    rng: {
      noise: () => {
        draws.push('noise');
        return noise();
      },
      judge: () => {
        draws.push('judge');
        return judgeValues();
      },
    },
    draws,
  };
}

function solveInput(overrides: Partial<SolveQuestionInput> = {}): SolveQuestionInput {
  return {
    participant,
    question,
    availableEnergy: 100,
    remainingClockMin: 300,
    focus: 0,
    mindset: 0,
    ...overrides,
  };
}

describe('solve-time estimate', () => {
  it('returns the reference time when all three gaps and focus are zero', () => {
    expect(estimateSolveTime({ participant, question, focus: 0 })).toBeCloseTo(90, 10);
  });

  it('matches the documented three-gap numerical anchor using the stated B_code=0.30', () => {
    const anchorParticipant: ParticipantSnapshot = {
      ...participant,
      abilities: { ...participant.abilities, DS: 50, THINKING: 48, CODING: 52 },
    };
    const anchorQuestion: QuestionSnapshot = {
      ...question,
      demand: 55,
      thought: 45,
      codeVolume: 50,
    };

    expect(
      estimateSolveTime({ participant: anchorParticipant, question: anchorQuestion, focus: 0 }),
    ).toBeCloseTo(88.8499645126, 8);
  });

  it('clamps maximum and minimum three-gap estimates to the documented bounds', () => {
    const weakest = {
      ...participant,
      abilities: { ...participant.abilities, DS: 0, THINKING: 0, CODING: 0 },
    };
    const strongest = {
      ...participant,
      abilities: { ...participant.abilities, DS: 100, THINKING: 100, CODING: 100 },
    };
    const maximum = { ...question, demand: 100, thought: 100, codeVolume: 100 };
    const minimum = { ...question, demand: 0, thought: 0, codeVolume: 0 };

    expect(estimateSolveTime({ participant: weakest, question: maximum, focus: 0 })).toBe(225);
    expect(estimateSolveTime({ participant: strongest, question: minimum, focus: 0 })).toBeCloseTo(
      31.5,
      12,
    );
  });

  it('uses full focus for the documented 40 percent speed-up', () => {
    expect(estimateSolveTime({ participant, question, focus: participant.focusCap })).toBeCloseTo(
      90 / 1.4,
      10,
    );
  });

  it('applies only hook modifiers whose conditions are active', () => {
    const hooks: ConditionalSolveHooks[] = [
      { condition: 'first_problem', time_k_mul: 0.75 },
      { condition: 'anti_ak', time_k_mul: 0.5 },
    ];

    expect(
      estimateSolveTime({
        participant,
        question,
        focus: 0,
        hooks,
        hookContext: { isFirstProblem: true, isAntiAk: false },
      }),
    ).toBeCloseTo(67.5, 10);
  });
});

describe('focus and energy accounting', () => {
  it('clamps focus at its cap for the maximum legal mindset', () => {
    expect(focusAfterAttempt({ focus: 49, focusCap: 50, investedMin: 100, mindset: 10 })).toBe(50);
  });

  it('clamps focus at zero when anxiety backlash exceeds accumulated focus', () => {
    expect(focusAfterAttempt({ focus: 4, focusCap: 50, investedMin: 10, mindset: -10 })).toBe(0);
  });

  it('calculates base, failure, and hook energy without going below zero', () => {
    expect(energyCost({ participant, question })).toBe(8);
    expect(
      energyCost({
        participant,
        question,
        waCount: 1,
        tleJudgeCount: 1,
        submissions: 2,
        hooks: [{ energy_cost_add: 2, energy_per_submit_add: 1 }],
      }),
    ).toBe(18);
  });
});

describe('single submission resolution', () => {
  it('normalizes a direct non-finite time estimate instead of leaking NaN', () => {
    const result = resolveAttempt(
      {
        attemptNumber: 1,
        estimatedTimeMin: Number.NaN,
        remainingClockMin: 10,
        acProbability: 1,
      },
      controlledRng([1, 0]),
    );

    expect(result.submissionTimeMin).toBe(0);
    expect(Number.isFinite(result.timeSpentMin)).toBe(true);
  });

  const input = {
    attemptNumber: 1,
    estimatedTimeMin: 90,
    remainingClockMin: 200,
    acProbability: 0.8,
  } as const;

  it('returns AC after a non-TLE accepted judge roll', () => {
    const { rng, draws } = recordingRng([0.5, 0.2]);

    expect(resolveAttempt(input, rng).verdict).toBe('AC');
    expect(draws).toEqual(['noise', 'noise', 'judge', 'judge']);
  });

  it('returns WA after a non-TLE rejected judge roll', () => {
    const { rng, draws } = recordingRng([0.5, 0.9]);
    const result = resolveAttempt(input, rng);

    expect(result.verdict).toBe('WA');
    expect(result.penaltyMin).toBe(20);
    expect(draws).toEqual(['noise', 'noise', 'judge', 'judge']);
  });

  it('returns judge TLE from the first judge roll', () => {
    const { rng, draws } = recordingRng([0]);
    const result = resolveAttempt(input, rng);

    expect(result.verdict).toBe('TLE');
    expect(result.penaltyMin).toBe(20);
    expect(draws).toEqual(['noise', 'noise', 'judge']);
  });

  it('returns UNFINISHED without advancing beyond the remaining clock', () => {
    const { rng, draws } = recordingRng([0.5, 0.2]);
    const result = resolveAttempt({ ...input, remainingClockMin: 30 }, rng);

    expect(result.verdict).toBe('UNFINISHED');
    expect(result.timeSpentMin).toBe(30);
    expect(draws).toEqual(['noise', 'noise']);
  });
});

describe('question solving flow', () => {
  it('returns SKIP with no time or energy cost when energy is insufficient', () => {
    const result = solveQuestion(solveInput({ availableEnergy: 0 }), controlledRng([0.5, 0.2]));

    expect(result.verdict).toBe('SKIP');
    expect(result.timeSpentMin).toBe(0);
    expect(result.energyAfter).toBe(0);
    expect(result.mindsetDelta).toBe(-3);
  });

  it('records WA and TLE distinctly before a later AC', () => {
    const afterWaRng = recordingRng([0.5, 0.99, 0.5, 0]);
    const afterTleRng = recordingRng([0, 0.5, 0]);
    const afterWa = solveQuestion(solveInput({ remainingClockMin: 500 }), afterWaRng.rng);
    const afterTle = solveQuestion(solveInput({ remainingClockMin: 500 }), afterTleRng.rng);

    expect(afterWa.verdict).toBe('AC');
    expect(afterWa.submissions.map((attempt) => attempt.verdict)).toEqual(['WA', 'AC']);
    expect(afterWa.energyCost).toBe(12);
    expect(afterWaRng.draws).toEqual([
      'noise',
      'noise',
      'judge',
      'judge',
      'noise',
      'noise',
      'judge',
      'judge',
    ]);
    expect(afterTle.verdict).toBe('AC');
    expect(afterTle.submissions.map((attempt) => attempt.verdict)).toEqual(['TLE', 'AC']);
    expect(afterTle.energyCost).toBe(10);
    expect(afterTleRng.draws).toEqual([
      'noise',
      'noise',
      'judge',
      'noise',
      'noise',
      'judge',
      'judge',
    ]);
  });

  it('returns UNFINISHED at the duration boundary with partial score and nonnegative energy', () => {
    const result = solveQuestion(
      solveInput({ availableEnergy: 8, remainingClockMin: 110, partialScores: true }),
      controlledRng([0.5, 0.99]),
    );

    expect(result.verdict).toBe('UNFINISHED');
    expect(result.timeSpentMin).toBe(110);
    expect(result.scoreAwarded).toBe(30);
    expect(result.energyAfter).toBe(0);
  });

  it('honors partial-score suppression hooks', () => {
    const result = solveQuestion(
      solveInput({
        availableEnergy: 8,
        remainingClockMin: 110,
        partialScores: true,
        hooks: [{ partial_override: 'trap' }],
      }),
      controlledRng([0.5, 0.99]),
    );

    expect(result.scoreAwarded).toBe(0);
  });

  it('returns deeply identical output for repeated input and labeled streams', () => {
    const input = solveInput({ remainingClockMin: 500 });
    const first = solveQuestion(input, {
      noise: createRandomStream(123, 'noise'),
      judge: createRandomStream(123, 'judge'),
    });
    const second = solveQuestion(input, {
      noise: createRandomStream(123, 'noise'),
      judge: createRandomStream(123, 'judge'),
    });

    expect(first).toEqual(second);
  });
});
