import { describe, expect, it } from 'vitest';
import type {
  AbilityKey,
  ParticipantSnapshot,
  QuestionSnapshot,
  RankingInput,
} from '@oinur/shared';
import { simulateRanking } from '../src/modules/contest/engine/ranking.js';
import { isPassingRank } from '../src/modules/contest/engine/report.js';

const abilityKeys: readonly AbilityKey[] = [
  'DS',
  'DP',
  'MATH',
  'GRAPH',
  'GREEDY',
  'STRING',
  'CODING',
  'THINKING',
  'PROBLEM',
];

function abilities(value: number): Record<AbilityKey, number> {
  return Object.fromEntries(abilityKeys.map((key) => [key, value])) as Record<AbilityKey, number>;
}

function participant(displayName: string, ability: number, energyMax = 100): ParticipantSnapshot {
  return {
    side: 'NPC',
    userId: null,
    studentId: null,
    displayName,
    abilities: abilities(ability),
    traits: [],
    mindset: 0,
    focusCap: 40,
    energyMax,
  };
}

function question(overrides: Partial<QuestionSnapshot> = {}): QuestionSnapshot {
  return {
    instanceId: 'stage:test#0',
    index: 0,
    dimension: 'DS',
    demand: 45,
    thought: 42,
    codeVolume: 35,
    score: 100,
    timeLimitMin: 20,
    partialScores: false,
    traits: [],
    source: 'GENERATED',
    ...overrides,
  };
}

const questions: QuestionSnapshot[] = [
  question({
    instanceId: 'stage:test#slow',
    index: 1,
    dimension: 'DP',
    demand: 55,
    thought: 52,
    codeVolume: 45,
    score: 40,
    timeLimitMin: 100,
  }),
  question({
    instanceId: 'stage:test#fast',
    index: 2,
    source: 'PREMADE',
    premadeEntryId: 7,
  }),
];

function rankingInput(overrides: Partial<RankingInput> = {}): RankingInput {
  return {
    kind: 'custom',
    student: { ...participant('Player', 85), side: 'HOME', userId: 1, studentId: 10 },
    participants: [participant('No energy', 60, 0)],
    problems: questions,
    durationMin: 80,
    ...overrides,
  };
}

describe('ranking simulation and ordering', () => {
  it('preserves participant order, selects the highest score/time question, and records timeline totals', () => {
    const report = simulateRanking(rankingInput(), 17);

    expect(report.participants.map(({ participant: entry }) => entry.displayName)).toEqual([
      'Player',
      'No energy',
    ]);
    expect(report.participants[0]?.attempts[0]?.questionIndex).toBe(2);
    expect(report.participants[1]?.attempts.map((attempt) => attempt.verdict)).toEqual([
      'SKIP',
      'SKIP',
    ]);
    expect(report.standings.find((standing) => standing.participantIndex === 1)?.totalScore).toBe(
      0,
    );

    for (const standing of report.standings) {
      const timeline = report.participants[standing.participantIndex];
      const reproducedScore = timeline?.attempts.reduce(
        (total, attempt) => total + attempt.resolution.scoreAwarded,
        0,
      );
      expect(standing.totalScore).toBe(reproducedScore);
    }
  });

  it('uses score, AC time, and stable participant index as the complete standings key', () => {
    const tied = rankingInput({
      student: { ...participant('First', 50, 0), side: 'HOME' },
      participants: [participant('Second', 50, 0), participant('Third', 50, 0)],
    });

    expect(simulateRanking(tied, 5).standings).toEqual([
      { participantIndex: 0, totalScore: 0, rank: 1 },
      { participantIndex: 1, totalScore: 0, rank: 2 },
      { participantIndex: 2, totalScore: 0, rank: 3 },
    ]);
  });

  it('breaks equal priorities by instanceId code-unit order before source position', () => {
    const report = simulateRanking(
      rankingInput({
        student: { ...participant('Player', 85), side: 'HOME' },
        participants: [],
        problems: [
          question({ instanceId: 'a-instance', index: 2 }),
          question({ instanceId: 'Z-instance', index: 1 }),
        ],
      }),
      5,
    );

    expect(report.participants[0]?.attempts[0]?.questionIndex).toBe(1);
  });

  it('distinguishes duplicate legacy numeric indexes by authoritative instanceId', () => {
    const duplicateIndexes = [
      question({
        instanceId: 'a-instance',
        index: 0,
        timeLimitMin: 5,
        traits: [{ traitId: 'force-ac', severity: 'red', hooks: [{ ac_prob_add: 1 }] }],
      }),
      question({
        instanceId: 'b-instance',
        index: 0,
        timeLimitMin: 5,
        traits: [{ traitId: 'force-ac', severity: 'red', hooks: [{ ac_prob_add: 1 }] }],
      }),
    ];

    const report = simulateRanking(
      rankingInput({
        student: { ...participant('Player', 85), side: 'HOME' },
        participants: [],
        problems: duplicateIndexes,
        durationMin: 100,
      }),
      5,
    );

    expect(report.participants[0]?.attempts.map((attempt) => attempt.problemInstanceId)).toEqual([
      'a-instance',
      'b-instance',
    ]);
    expect(report.participants[0]?.attempts.map((attempt) => attempt.questionIndex)).toEqual([
      0, 0,
    ]);
  });

  it('uses the fixed rank-eight pass line', () => {
    expect(isPassingRank(1)).toBe(true);
    expect(isPassingRank(8)).toBe(true);
    expect(isPassingRank(9)).toBe(false);

    const report = simulateRanking(rankingInput(), 9);
    const playerRank = report.standings.find((standing) => standing.participantIndex === 0)?.rank;
    expect(report.pass).toBe(isPassingRank(playerRank ?? Number.POSITIVE_INFINITY));
  });

  it('preserves participant traits as archival data without activating solver hooks', () => {
    const archivedTrait = { traitId: 'participant-precision-hell' };
    const baseInput = rankingInput({ participants: [] });
    const withTrait = simulateRanking(
      {
        ...baseInput,
        student: { ...baseInput.student, traits: [archivedTrait] },
      },
      29,
    );
    const withoutTrait = simulateRanking(
      {
        ...baseInput,
        student: { ...baseInput.student, traits: [] },
      },
      29,
    );

    expect(withTrait.inputSnapshot.student.traits).toEqual([archivedTrait]);
    expect(withTrait.participants[0]?.participant.traits).toEqual([archivedTrait]);
    expect(withTrait.participants[0]?.attempts).toEqual(withoutTrait.participants[0]?.attempts);
  });

  it('does not mutate input snapshots', () => {
    const input = rankingInput({
      stageRef: { chapter: 'cspj', stageIndex: 2, ngPlusLayer: 1 },
    });
    const before = structuredClone(input);

    simulateRanking(input, 99);

    expect(input).toEqual(before);
  });
});

describe('ranking input validation', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid duration %s',
    (durationMin) => {
      expect(() => simulateRanking(rankingInput({ durationMin }), 1)).toThrow();
    },
  );

  it('rejects empty problem sets before simulation', () => {
    expect(() => simulateRanking(rankingInput({ problems: [] }), 1)).toThrow();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000])(
    'rejects invalid seed %s',
    (seed) => {
      expect(() => simulateRanking(rankingInput(), seed)).toThrow();
    },
  );

  it('enforces ability values from 1 to 100 while mindset remains from -10 to 10', () => {
    for (const ability of [1, 100]) {
      expect(() =>
        simulateRanking(
          rankingInput({ student: { ...participant('Player', ability), side: 'HOME' } }),
          1,
        ),
      ).not.toThrow();
    }
    for (const ability of [0, 101]) {
      expect(() =>
        simulateRanking(
          rankingInput({ student: { ...participant('Player', ability), side: 'HOME' } }),
          1,
        ),
      ).toThrow();
    }
    for (const mindset of [-10, 10]) {
      expect(() =>
        simulateRanking(rankingInput({ student: { ...rankingInput().student, mindset } }), 1),
      ).not.toThrow();
    }
    for (const mindset of [-11, 11]) {
      expect(() =>
        simulateRanking(rankingInput({ student: { ...rankingInput().student, mindset } }), 1),
      ).toThrow();
    }
  });

  it('rejects non-finite snapshots and malformed frozen hooks', () => {
    const badParticipant = rankingInput({
      student: {
        ...rankingInput().student,
        abilities: { ...rankingInput().student.abilities, DS: Number.NaN },
      },
    });
    const badQuestion = rankingInput({
      problems: [question({ score: Number.POSITIVE_INFINITY })],
    });
    const badHook = rankingInput({
      problems: [
        question({
          traits: [
            {
              traitId: 'frozen-hook',
              severity: 'red',
              hooks: [{ ac_prob_add: Number.NaN }],
            },
          ],
        }),
      ],
    });

    expect(() => simulateRanking(badParticipant, 1)).toThrow();
    expect(() => simulateRanking(badQuestion, 1)).toThrow();
    expect(() => simulateRanking(badHook, 1)).toThrow();
  });
});

describe('ranking strength monotonicity', () => {
  it('keeps the stronger participant within explicit bounds across 64 seeds', () => {
    const sampleQuestions: QuestionSnapshot[] = [0, 1, 2, 3].map((offset) =>
      question({
        instanceId: `sample#${offset}`,
        index: offset,
        dimension: offset % 2 === 0 ? 'DS' : 'DP',
        demand: 55 + offset * 3,
        thought: 52 + offset * 3,
        codeVolume: 45 + offset * 4,
        score: 100,
        timeLimitMin: 45 + offset * 10,
      }),
    );
    const input = rankingInput({
      student: { ...participant('Weak', 20), side: 'HOME' },
      participants: [participant('Strong', 95)],
      problems: sampleQuestions,
      durationMin: 240,
    });
    let weakRankTotal = 0;
    let strongRankTotal = 0;
    let strongWins = 0;

    for (let seed = 0; seed < 64; seed += 1) {
      const standings = simulateRanking(input, seed).standings;
      const weakRank = standings.find((standing) => standing.participantIndex === 0)?.rank ?? 0;
      const strongRank = standings.find((standing) => standing.participantIndex === 1)?.rank ?? 0;
      weakRankTotal += weakRank;
      strongRankTotal += strongRank;
      if (strongRank < weakRank) strongWins += 1;
    }

    expect(strongWins).toBeGreaterThanOrEqual(56);
    expect(strongRankTotal / 64).toBeLessThanOrEqual(1.125);
    expect(weakRankTotal / 64).toBeGreaterThanOrEqual(1.875);
  });
});
