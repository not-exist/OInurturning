import { describe, expect, it } from 'vitest';
import type { AbilityKey, ParticipantSnapshot, QuestionSnapshot, RankingInput } from '@oinur/shared';
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
    mindset: 0,
    focusCap: 40,
    energyMax,
  };
}

const questions: QuestionSnapshot[] = [
  {
    index: 1,
    dimension: 'DP',
    demand: 55,
    thought: 52,
    codeVolume: 45,
    score: 40,
    timeLimitMin: 100,
    source: 'GENERATED',
  },
  {
    index: 2,
    dimension: 'DS',
    demand: 45,
    thought: 42,
    codeVolume: 35,
    score: 100,
    timeLimitMin: 20,
    source: 'PREMADE',
    premadeEntryId: 7,
  },
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

describe('deterministic ranking simulator', () => {
  it('preserves participant order, selects the highest score/time question, and records timeline totals', () => {
    const report = simulateRanking(rankingInput(), 17);

    expect(report.participants.map(({ participant: entry }) => entry.displayName)).toEqual(['Player', 'No energy']);
    expect(report.participants[0]?.attempts[0]?.questionIndex).toBe(2);
    expect(report.participants[1]?.attempts.map((attempt) => attempt.verdict)).toEqual(['SKIP', 'SKIP']);
    expect(report.standings.find((standing) => standing.participantIndex === 1)?.totalScore).toBe(0);

    for (const standing of report.standings) {
      const timeline = report.participants[standing.participantIndex];
      const reproducedScore = timeline?.attempts.reduce(
        (total, attempt) => total + ('resolution' in attempt ? attempt.resolution.scoreAwarded : 0),
        0,
      );
      expect(standing.totalScore).toBe(reproducedScore);
    }
  });

  it('uses score, AC time, and stable participant index as the complete standings key', () => {
    const tied = rankingInput({
      student: { ...participant('First', 50), side: 'HOME' },
      participants: [participant('Second', 50), participant('Third', 50)],
      durationMin: 0,
    });

    expect(simulateRanking(tied, 5).standings).toEqual([
      { participantIndex: 0, totalScore: 0, rank: 1 },
      { participantIndex: 1, totalScore: 0, rank: 2 },
      { participantIndex: 2, totalScore: 0, rank: 3 },
    ]);
  });

  it('uses the fixed rank-eight pass line', () => {
    expect(isPassingRank(1)).toBe(true);
    expect(isPassingRank(8)).toBe(true);
    expect(isPassingRank(9)).toBe(false);

    const report = simulateRanking(rankingInput({ durationMin: 0 }), 9);
    const playerRank = report.standings.find((standing) => standing.participantIndex === 0)?.rank;
    expect(report.pass).toBe(isPassingRank(playerRank ?? Number.POSITIVE_INFINITY));
  });

  it('does not mutate input snapshots', () => {
    const input = rankingInput({
      stageRef: { chapter: 'cspj', stageIndex: 2, ngPlusLayer: 1 },
    });
    const before = structuredClone(input);

    simulateRanking(input, 99);

    expect(input).toEqual(before);
  });

  it('gives a strictly better bounded multi-seed mean rank to the stronger participant', () => {
    const sampleQuestions: QuestionSnapshot[] = [0, 1, 2, 3].map((offset) => ({
      index: offset,
      dimension: offset % 2 === 0 ? 'DS' : 'DP',
      demand: 55 + offset * 3,
      thought: 52 + offset * 3,
      codeVolume: 45 + offset * 4,
      score: 100,
      timeLimitMin: 45 + offset * 10,
      source: 'GENERATED',
    }));
    const input = rankingInput({
      student: { ...participant('Weak', 38), side: 'HOME' },
      participants: [participant('Strong', 78)],
      problems: sampleQuestions,
      durationMin: 240,
    });
    let weakRankTotal = 0;
    let strongRankTotal = 0;

    for (let seed = 0; seed < 64; seed += 1) {
      const standings = simulateRanking(input, seed).standings;
      weakRankTotal += standings.find((standing) => standing.participantIndex === 0)?.rank ?? 0;
      strongRankTotal += standings.find((standing) => standing.participantIndex === 1)?.rank ?? 0;
    }

    expect(strongRankTotal / 64).toBeLessThan(weakRankTotal / 64);
  });
});
