import { describe, expect, it } from 'vitest';
import type { AbilityKey, ContestSummary, ParticipantSnapshot, RankingInput } from '@oinur/shared';
import { simulateRanking } from '../src/modules/contest/engine/ranking.js';
import {
  ENGINE_VERSION,
  buildContestSummary,
  serializeRankingReport,
  stableHash,
  stableSerialize,
} from '../src/modules/contest/engine/report.js';
import { RNG_VERSION } from '../src/modules/contest/engine/rng.js';

function participant(): ParticipantSnapshot {
  const abilities = Object.fromEntries(
    (['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING', 'CODING', 'THINKING', 'PROBLEM'] as AbilityKey[]).map(
      (key) => [key, 70],
    ),
  ) as Record<AbilityKey, number>;

  return {
    side: 'HOME',
    userId: 11,
    studentId: 22,
    displayName: 'Replay Player',
    abilities,
    mindset: 2,
    focusCap: 35,
    energyMax: 90,
  };
}

function input(): RankingInput {
  return {
    kind: 'story',
    stageRef: { chapter: 'csps', stageIndex: 3, ngPlusLayer: 2 },
    student: participant(),
    participants: [],
    problems: [
      {
        index: 3,
        dimension: 'GREEDY',
        demand: 68,
        thought: 65,
        codeVolume: 60,
        score: 100,
        timeLimitMin: 75,
        trait: { traitId: 'miracle-easy', severity: 'colorful' },
        source: 'GENERATED',
      },
    ],
    durationMin: 180,
    firstClearAvailable: true,
  };
}

describe('ranking report determinism', () => {
  it('produces byte-equivalent validated reports for identical input and seed', () => {
    const contestInput = input();
    const first = simulateRanking(contestInput, 0x1234abcd);
    const second = simulateRanking(contestInput, 0x1234abcd);
    const firstBytes = serializeRankingReport(first);
    const secondBytes = serializeRankingReport(second);

    expect(firstBytes).toBe(secondBytes);
    expect(firstBytes).toBe(stableSerialize(first));
    expect(stableHash(first)).toBe(stableHash(second));
  });

  it('fills replay metadata from constants and the frozen input snapshot', () => {
    const contestInput = input();
    const report = simulateRanking(contestInput, -1);

    expect(report).toMatchObject({
      reportVersion: 1,
      engineVersion: ENGINE_VERSION,
      rngVersion: RNG_VERSION,
      seed: 0xffffffff,
      snapshotHash: stableHash(contestInput),
      stageRef: contestInput.stageRef,
    });
    expect(report.createdAt).toBe('1970-02-19T17:02:47.295Z');
    expect(report.questions).not.toBe(contestInput.problems);
    expect(report.participants[0]?.participant).not.toBe(contestInput.student);
  });

  it('changes the snapshot hash when replay input changes', () => {
    const original = input();
    const changed = { ...input(), durationMin: input().durationMin + 1 };

    expect(simulateRanking(original, 44).snapshotHash).not.toBe(simulateRanking(changed, 44).snapshotHash);
  });

  it('builds the discriminated compact summary and preserves settlement lines', () => {
    const report = simulateRanking(input(), 72);
    report.rewards.push({ type: 'rank_bonus_money', rank: 1, amount: 300 });
    report.growth.push({ attr: 'greedy', delta: 1, sourceProblem: 'csps:3#3' });

    const summary = buildContestSummary(report);
    const expected: ContestSummary = {
      format: 'RANKING',
      rank: report.standings[0]?.rank ?? 0,
      participantCount: 1,
      totalScore: report.standings[0]?.totalScore ?? 0,
      rewards: report.rewards,
      growth: report.growth,
    };

    expect(summary).toEqual(expected);
    expect(summary.rewards).not.toBe(report.rewards);
    expect(summary.growth).not.toBe(report.growth);
  });
});
