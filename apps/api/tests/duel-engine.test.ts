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

type DuelSide = 'HOME' | 'AWAY';

type ParticipantOptions = {
  energy?: number;
  energyMax?: number;
  mindset?: number;
};

function participant(
  side: DuelSide,
  memberIndex: number,
  options: ParticipantOptions = {},
): ParticipantSnapshot {
  const idBase = side === 'HOME' ? 100 : 200;
  const studentBase = side === 'HOME' ? 1000 : 2000;
  const snapshot: ParticipantSnapshot = {
    side,
    userId: idBase + memberIndex,
    studentId: studentBase + memberIndex,
    displayName: `${side}-${memberIndex}`,
    abilities: Object.fromEntries(abilityKeys.map((key) => [key, 50])) as Record<
      AbilityKey,
      number
    >,
    traits: [],
    mindset: options.mindset ?? 0,
    focusCap: 30,
    energyMax: options.energyMax ?? 100,
  };
  if (options.energy !== undefined) snapshot.energy = options.energy;
  return snapshot;
}

function members(
  side: DuelSide,
  count: number,
  options: ParticipantOptions = {},
): ParticipantSnapshot[] {
  return Array.from({ length: count }, (_, memberIndex) =>
    participant(side, memberIndex, options),
  );
}

function question(instanceId: string, index: number, quality: number): QuestionSnapshot {
  return {
    instanceId,
    index,
    dimension: 'DS',
    demand: 50,
    thought: 50,
    codeVolume: 10,
    score: 100,
    quality,
    timeLimitMin: 30,
    partialScores: false,
    traits: [],
    source: 'GENERATED',
  };
}

function questions(count: number, quality: (index: number) => number = (index) => (index % 2 === 0 ? 90 : 10)) {
  return Array.from({ length: count }, (_, index) =>
    question(`duel-${index}`, index, quality(index)),
  );
}

function duelInput(overrides: Partial<DuelInput> = {}): DuelInput {
  return {
    home: { members: members('HOME', 3) },
    away: { members: members('AWAY', 3) },
    questions: questions(6),
    qualityRuleOn: false,
    tiebreak: 'FRIENDLY',
    ...overrides,
  };
}

function scoreTrail(report: ReturnType<typeof simulateDuel>) {
  let home = 0;
  let away = 0;
  return report.rounds.map((round) => {
    if (round.scoreAwardedTo === 'HOME') home += round.scoreAwarded;
    else away += round.scoreAwarded;
    return { home, away };
  });
}

describe('duel input fixtures', () => {
  it('builds two three-member teams with side-specific member IDs and six questions', () => {
    const input = duelInput();

    expect(input.home.members).toHaveLength(3);
    expect(input.away.members).toHaveLength(3);
    expect(input.home.members.map((member) => member.side)).toEqual(['HOME', 'HOME', 'HOME']);
    expect(input.away.members.map((member) => member.side)).toEqual(['AWAY', 'AWAY', 'AWAY']);
    expect(input.home.members.map((member) => member.userId)).toEqual([100, 101, 102]);
    expect(input.away.members.map((member) => member.userId)).toEqual([200, 201, 202]);
    expect(input.home.members.map((member) => member.studentId)).toEqual([1000, 1001, 1002]);
    expect(input.away.members.map((member) => member.studentId)).toEqual([2000, 2001, 2002]);
    expect(input.questions).toHaveLength(6);
  });
});

describe('duel simulation', () => {
  it('delegates successful answers to the shared solver and carries member state', () => {
    const easyQuestions = questions(6).map((entry) => ({
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
    const report = simulateDuel(duelInput({ questions: easyQuestions }), 17);
    const solvedRounds = report.rounds.filter((round) => round.solved);

    expect(report.rounds).toHaveLength(6);
    expect(solvedRounds.length).toBeGreaterThan(0);
    expect(solvedRounds.every((round) => round.reason === 'AC')).toBe(true);
    expect(solvedRounds.every((round) => round.answererMindsetDelta === 2)).toBe(true);
    expect(report.rounds.some((round) => round.energyCost > 0)).toBe(true);
    expect(stableHash(report.inputSnapshot)).toBe(report.snapshotHash);
  });

  it('runs six regular rounds with one setter and answerer duty per member', () => {
    const report = simulateDuel(duelInput(), 17);

    expect(report.rounds).toHaveLength(6);
    expect(report.rounds.map((round) => round.roundNo)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(report.rounds.map((round) => round.setterSide)).toEqual([
      'HOME',
      'AWAY',
      'HOME',
      'AWAY',
      'HOME',
      'AWAY',
    ]);
    expect(report.rounds.map((round) => round.setterMemberIndex)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(report.rounds.map((round) => round.answererMemberIndex)).toEqual([1, 1, 2, 2, 0, 0]);
    expect(report.rounds.map((round) => round.question.instanceId)).toEqual([
      'duel-0',
      'duel-1',
      'duel-2',
      'duel-3',
      'duel-4',
      'duel-5',
    ]);

    for (const side of ['HOME', 'AWAY'] as const) {
      expect(
        report.rounds
          .filter((round) => round.setterSide === side)
          .map((round) => round.setterMemberIndex),
      ).toEqual([0, 1, 2]);
      expect(
        report.rounds
          .filter((round) => round.answererSide === side)
          .map((round) => round.answererMemberIndex),
      ).toEqual([1, 2, 0]);
    }

    expect(report.scoreAfterEachRound).toEqual(scoreTrail(report));
    expect(report.scores).toEqual(report.scoreAfterEachRound.at(-1));
  });

  it('keeps the 2N rotation for four-member teams', () => {
    const report = simulateDuel(
      duelInput({
        home: { members: members('HOME', 4) },
        away: { members: members('AWAY', 4) },
        questions: questions(8),
      }),
      17,
    );

    expect(report.rounds).toHaveLength(8);
    expect(report.rounds.map((round) => round.setterMemberIndex)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
    expect(report.rounds.map((round) => round.answererMemberIndex)).toEqual([
      1, 1, 2, 2, 3, 3, 0, 0,
    ]);
  });

  it('marks every answer as an energy forfeit when all team members are exhausted', () => {
    const report = simulateDuel(
      duelInput({
        home: { members: members('HOME', 3, { energy: 0, energyMax: 0 }) },
        away: { members: members('AWAY', 3, { energy: 0, energyMax: 0 }) },
      }),
      17,
    );

    expect(report.rounds.every((round) => round.forfeitEnergy)).toBe(true);
    expect(report.rounds.every((round) => round.reason === 'UNFINISHED')).toBe(true);
    expect(report.scores).toEqual({ home: 3, away: 3 });
  });

  it('awards quality-rule points to setters for unsolved premade questions', () => {
    const premadeQuestions = questions(6).map((entry, index) => ({
      ...entry,
      source: 'PREMADE' as const,
      premadeEntryId: index + 1,
    }));
    const report = simulateDuel(
      duelInput({
        home: { members: members('HOME', 3, { energy: 0, energyMax: 0 }) },
        away: { members: members('AWAY', 3, { energy: 0, energyMax: 0 }) },
        questions: premadeQuestions,
        qualityRuleOn: true,
      }),
      17,
    );

    expect(report.rounds.map((round) => round.question.premadeEntryId)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(report.rounds.every((round) => round.problemSource === 'PREMADE')).toBe(true);
    expect(report.rounds.every((round) => round.solved === false && round.scoreAwarded === 2)).toBe(
      true,
    );
    expect(report.scores).toEqual({ home: 6, away: 6 });
  });

  it('uses summed team state for energy, quality, and friendly tiebreaks', () => {
    const energyReport = simulateDuel(
      duelInput({
        home: { members: members('HOME', 3, { energy: 0.5, energyMax: 1 }) },
        away: { members: members('AWAY', 3, { energy: 0, energyMax: 1 }) },
        tiebreak: 'ENERGY',
      }),
      17,
    );
    const qualityReport = simulateDuel(
      duelInput({
        home: { members: members('HOME', 3, { energy: 0, energyMax: 0 }) },
        away: { members: members('AWAY', 3, { energy: 0, energyMax: 0 }) },
        tiebreak: 'QUALITY',
      }),
      17,
    );
    const friendlyReport = simulateDuel(
      duelInput({
        home: { members: members('HOME', 3, { energy: 0, energyMax: 0 }) },
        away: { members: members('AWAY', 3, { energy: 0, energyMax: 0 }) },
        questions: questions(6, () => 50),
        tiebreak: 'FRIENDLY',
      }),
      17,
    );

    expect(energyReport.scores).toEqual({ home: 3, away: 3 });
    expect(energyReport.winnerSide).toBe('HOME');
    expect(qualityReport.scores).toEqual({ home: 3, away: 3 });
    expect(qualityReport.winnerSide).toBe('HOME');
    expect(friendlyReport.scores).toEqual({ home: 3, away: 3 });
    expect(friendlyReport.winnerSide).toBe('DRAW');
  });

  it('generates insufficient sudden-death questions and continues the rotation', () => {
    const report = simulateDuel(
      duelInput({
        home: { members: members('HOME', 3, { energy: 0, energyMax: 0 }) },
        away: { members: members('AWAY', 3, { energy: 0, energyMax: 0 }) },
        tiebreak: 'SUDDEN_DEATH',
      }),
      23,
    );
    const suddenDeathRounds = report.rounds.slice(6);

    expect(suddenDeathRounds).toHaveLength(6);
    expect(suddenDeathRounds.every((round) => round.question.source === 'GENERATED')).toBe(true);
    expect(report.rounds.map((round) => round.roundNo)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(report.rounds.map((round) => round.setterMemberIndex)).toEqual([
      0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2,
    ]);
    expect(report.rounds.map((round) => round.answererMemberIndex)).toEqual([
      1, 1, 2, 2, 0, 0, 1, 1, 2, 2, 0, 0,
    ]);
  });

  it('replays all rounds and winner deterministically for a fixed seed', () => {
    const input = duelInput({
      home: { members: members('HOME', 3, { energy: 0, energyMax: 0 }) },
      away: { members: members('AWAY', 3, { energy: 0, energyMax: 0 }) },
      tiebreak: 'SUDDEN_DEATH',
    });
    const first = simulateDuel(input, 23);
    const second = simulateDuel(input, 23);

    expect(second).toEqual(first);
    expect(first.rounds.length).toBeGreaterThan(6);
    expect(first.winnerSide).toMatch(/HOME|AWAY|DRAW/);
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
      homeEnergy: mode === 'ENERGY' ? 90 : 150,
      awayEnergy: mode === 'ENERGY' ? 10 : 150,
      homeQuality: mode === 'QUALITY' ? 30 : 150,
      awayQuality: mode === 'QUALITY' ? 270 : 150,
      homePenaltyMin: 20,
      awayPenaltyMin: 20,
      seed: 8,
    };

    expect(resolveTiebreak(input)).toBe(expected);
  });

  it('awards the sudden-death penalty fallback to the lower-penalty side', () => {
    expect(
      resolveTiebreak({
        mode: 'SUDDEN_DEATH',
        homeEnergy: 150,
        awayEnergy: 150,
        homeQuality: 300,
        awayQuality: 300,
        homePenaltyMin: 5,
        awayPenaltyMin: 20,
        seed: 1,
      }),
    ).toBe('HOME');
  });
});

describe('duel input schema boundaries', () => {
  it('rejects teams outside the 3-to-4 member range', () => {
    expect(() =>
      simulateDuel(
        duelInput({
          home: { members: members('HOME', 2) },
          away: { members: members('AWAY', 2) },
        }),
        17,
      ),
    ).toThrow();
    expect(() =>
      simulateDuel(
        duelInput({
          home: { members: members('HOME', 5) },
          away: { members: members('AWAY', 5) },
          questions: questions(10),
        }),
        17,
      ),
    ).toThrow();
  });

  it('rejects unequal team sizes and too few regular questions', () => {
    expect(() =>
      simulateDuel(
        duelInput({
          home: { members: members('HOME', 3) },
          away: { members: members('AWAY', 4) },
          questions: questions(8),
        }),
        17,
      ),
    ).toThrow();
    expect(() =>
      simulateDuel(
        duelInput({
          questions: questions(5),
        }),
        17,
      ),
    ).toThrow();
  });
});
