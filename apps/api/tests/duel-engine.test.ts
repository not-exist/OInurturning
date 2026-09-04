import { describe, expect, it } from 'vitest';
import type {
  AbilityKey,
  DuelInput,
  DuelTiebreakInput,
  ParticipantSnapshot,
  QuestionSnapshot,
} from '@oinur/shared';
import { duelReportSchema } from '@oinur/shared';
import { resolveTiebreak, simulateDuel } from '../src/modules/contest/engine/duel.js';
import { stableHash } from '../src/modules/contest/engine/report.js';

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

function participant(side: ParticipantSnapshot['side'], energyMax = 100): ParticipantSnapshot {
  return {
    side,
    userId: side === 'HOME' ? 1 : 2,
    studentId: side === 'HOME' ? 10 : 20,
    displayName: side,
    abilities: Object.fromEntries(abilityKeys.map((key) => [key, 50])) as Record<
      AbilityKey,
      number
    >,
    traits: [],
    mindset: 0,
    focusCap: 30,
    energyMax,
  };
}

function question(instanceId: string, quality: number): QuestionSnapshot {
  return {
    instanceId,
    index: Number(instanceId.slice(-1)),
    dimension: 'DS',
    demand: 50,
    thought: 50,
    codeVolume: 10,
    score: 100,
    quality,
    timeLimitMin: 30,
    partialScores: false,
    traits: [
      {
        traitId: 'duel-stall',
        severity: 'red',
        hooks: [{ submit_time_add: 1000 }],
      },
    ],
    source: 'GENERATED',
  };
}

function duelInput(overrides: Partial<DuelInput> = {}): DuelInput {
  return {
    home: participant('HOME'),
    away: participant('AWAY'),
    questions: [
      question('home-0', 90),
      question('away-0', 10),
      question('home-1', 90),
      question('away-1', 10),
    ],
    qualityRuleOn: false,
    tiebreak: 'FRIENDLY',
    ...overrides,
  };
}

describe('duel simulation', () => {
  it('delegates successful answers to the shared solver and carries energy/mindset state', () => {
    const questions = duelInput().questions.map((entry) => ({
      ...entry,
      timeLimitMin: 100,
      traits: [
        {
          traitId: 'duel-easy',
          severity: 'red' as const,
          hooks: [{ ac_prob_add: 1, tle_prob_add: -1 }],
        },
      ],
    }));
    const report = simulateDuel(duelInput({ questions }), 17);

    expect(report.rounds.some((round) => round.solved)).toBe(true);
    expect(
      report.rounds.filter((round) => round.solved).every((round) => round.reason === 'AC'),
    ).toBe(true);
    expect(
      report.rounds
        .filter((round) => round.solved)
        .every((round) => round.answererMindsetDelta === 2),
    ).toBe(true);
    expect(report.rounds.some((round) => round.energyCost > 0)).toBe(true);
    expect(stableHash(report.inputSnapshot)).toBe(report.snapshotHash);
  });

  it('runs four alternating setter rounds and preserves question ownership', () => {
    const report = simulateDuel(duelInput(), 17);

    expect(report.rounds).toHaveLength(4);
    expect(report.rounds.map((round) => round.setterSide)).toEqual([
      'HOME',
      'AWAY',
      'HOME',
      'AWAY',
    ]);
    expect(report.rounds.map((round) => round.answerer.side)).toEqual([
      'AWAY',
      'HOME',
      'AWAY',
      'HOME',
    ]);
    expect(report.rounds.map((round) => round.question.instanceId)).toEqual([
      'home-0',
      'away-0',
      'home-1',
      'away-1',
    ]);
    expect(report.rounds.every((round) => round.answerer.side !== round.setterSide)).toBe(true);
    expect(report.rounds.every((round) => round.scoreAwarded === 1)).toBe(true);
    expect(report.scores).toEqual({ home: 2, away: 2 });
    expect(report.rounds.every((round) => round.roundLimitMin === 37.5)).toBe(true);
  });

  it('preserves premade question selection and awards quality-rule points to setters', () => {
    const questions = duelInput().questions.map((entry, index) => ({
      ...entry,
      source: 'PREMADE' as const,
      premadeEntryId: index + 1,
    }));
    const report = simulateDuel(duelInput({ questions, qualityRuleOn: true }), 17);

    expect(report.rounds.map((round) => round.question.premadeEntryId)).toEqual([1, 2, 3, 4]);
    expect(report.rounds.every((round) => round.problemSource === 'PREMADE')).toBe(true);
    expect(report.rounds.every((round) => round.solved === false && round.scoreAwarded === 2)).toBe(
      true,
    );
    expect(report.scores).toEqual({ home: 4, away: 4 });
  });

  it('replays duel rounds and winner deterministically for a fixed seed', () => {
    const first = simulateDuel(duelInput({ tiebreak: 'SUDDEN_DEATH' }), 23);
    const second = simulateDuel(duelInput({ tiebreak: 'SUDDEN_DEATH' }), 23);

    expect(second).toEqual(first);
    expect(first.rounds.length).toBeGreaterThan(4);
    expect(first.winnerSide).toMatch(/HOME|AWAY/);
  });

  it('rejects report score tampering at the shared boundary', () => {
    const report = simulateDuel(duelInput(), 17);
    const tampered = structuredClone(report);
    tampered.scores.home += 1;

    expect(duelReportSchema.safeParse(tampered).success).toBe(false);
  });
});

describe('duel tiebreaks', () => {
  it.each([
    ['ENERGY', 'HOME'],
    ['QUALITY', 'AWAY'],
    ['FRIENDLY', 'DRAW'],
  ] as const)('resolves %s deterministically', (mode, expected) => {
    const input: DuelTiebreakInput = {
      mode,
      homeEnergy: mode === 'ENERGY' ? 90 : 50,
      awayEnergy: mode === 'ENERGY' ? 10 : 50,
      homeQuality: mode === 'QUALITY' ? 10 : 50,
      awayQuality: mode === 'QUALITY' ? 90 : 50,
      homePenaltyMin: 20,
      awayPenaltyMin: 20,
      seed: 8,
    };

    expect(resolveTiebreak(input)).toBe(expected);
  });

  it('uses the documented post-round energy comparison for the energy branch', () => {
    const report = simulateDuel(
      duelInput({
        home: participant('HOME', 100),
        away: participant('AWAY', 40),
        tiebreak: 'ENERGY',
      }),
      17,
    );

    expect(report.scores).toEqual({ home: 2, away: 2 });
    expect(report.winnerSide).toBe('HOME');
  });

  it('awards the sudden-death penalty fallback to the lower-penalty side', () => {
    expect(
      resolveTiebreak({
        mode: 'SUDDEN_DEATH',
        homeEnergy: 50,
        awayEnergy: 50,
        homeQuality: 100,
        awayQuality: 100,
        homePenaltyMin: 5,
        awayPenaltyMin: 20,
        seed: 1,
      }),
    ).toBe('HOME');
  });

  it('uses question quality and returns DRAW for a friendly tie', () => {
    const qualityReport = simulateDuel(duelInput({ tiebreak: 'QUALITY' }), 17);
    const friendlyReport = simulateDuel(duelInput({ tiebreak: 'FRIENDLY' }), 17);

    expect(qualityReport.winnerSide).toBe('HOME');
    expect(friendlyReport.winnerSide).toBe('DRAW');
  });
});
