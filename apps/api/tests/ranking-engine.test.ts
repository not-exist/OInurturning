import { describe, expect, it } from 'vitest';
import {
  TEAM_SIZE_MAX,
  rankingInputSchema,
  type AbilityKey,
  type ContestTeam,
  type ParticipantSnapshot,
  type QuestionSnapshot,
  type RankingInput,
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

const ROSTER_SIZE = 3;

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

/** 把一名成员复制到整支队伍，队内序号写进名字以便核对 participants 顺序。 */
function roster(member: ParticipantSnapshot, size = ROSTER_SIZE): ParticipantSnapshot[] {
  return Array.from({ length: size }, (_, memberIndex) => ({
    ...member,
    abilities: { ...member.abilities },
    traits: [...member.traits],
    displayName: `${member.displayName}·${memberIndex + 1}`,
  }));
}

function homeTeam(member: ParticipantSnapshot, size = ROSTER_SIZE): ContestTeam {
  return {
    teamId: 'home',
    side: 'HOME',
    userId: 1,
    members: roster(member, size).map((entry, memberIndex) => ({
      ...entry,
      side: 'HOME',
      userId: 1,
      studentId: 10 + memberIndex,
    })),
  };
}

function npcTeam(teamId: string, member: ParticipantSnapshot, size = ROSTER_SIZE): ContestTeam {
  return {
    teamId,
    side: 'NPC',
    userId: null,
    members: roster(member, size).map((entry) => ({ ...entry, side: 'NPC', userId: null, studentId: null })),
  };
}

/** 玩家队 + 至少一支 NPC 队，满足 RankingInput 的 teams 约束。 */
function teams(member: ParticipantSnapshot, size = ROSTER_SIZE): ContestTeam[] {
  return [homeTeam(member, size), npcTeam('npc:0', participant('Sparring', 50), size)];
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

function player(): ParticipantSnapshot {
  return { ...participant('Player', 85), side: 'HOME', userId: 1, studentId: 10 };
}

function rankingInput(overrides: Partial<RankingInput> = {}): RankingInput {
  return {
    kind: 'custom',
    teams: [homeTeam(player()), npcTeam('npc:0', participant('No energy', 60, 0))],
    problems: questions,
    durationMin: 80,
    ...overrides,
  };
}

function memberTimelines(report: ReturnType<typeof simulateRanking>, teamIndex: number) {
  let offset = 0;
  for (let index = 0; index < teamIndex; index += 1) {
    offset += report.teams[index]!.members.length;
  }
  return report.participants.slice(offset, offset + report.teams[teamIndex]!.members.length);
}

function memberScoreSum(report: ReturnType<typeof simulateRanking>, teamIndex: number): number {
  return memberTimelines(report, teamIndex).reduce(
    (total, timeline) =>
      total + timeline.attempts.reduce((sum, attempt) => sum + attempt.resolution.scoreAwarded, 0),
    0,
  );
}

describe('ranking simulation and ordering', () => {
  it('simulates every team member independently and keeps the flat member order', () => {
    const report = simulateRanking(rankingInput(), 17);

    expect(report.teams).toHaveLength(2);
    expect(report.participants).toHaveLength(ROSTER_SIZE * 2);
    expect(report.participants.map(({ participant: entry }) => entry.displayName)).toEqual([
      'Player·1',
      'Player·2',
      'Player·3',
      'No energy·1',
      'No energy·2',
      'No energy·3',
    ]);
    expect(report.participants[0]?.attempts[0]?.questionIndex).toBe(2);
    expect(report.participants[3]?.attempts.map((attempt) => attempt.verdict)).toEqual([
      'SKIP',
      'SKIP',
    ]);

    for (const standing of report.standings) {
      expect(standing.totalScore).toBeLessThanOrEqual(memberScoreSum(report, standing.teamIndex));
    }
  });

  it('counts each problem once per team using the best member attempt', () => {
    const base = player();
    const members: ParticipantSnapshot[] = [
      { ...base, displayName: 'Strong·1', abilities: abilities(95), studentId: 10 },
      { ...base, displayName: 'Mid·2', abilities: abilities(75), studentId: 11 },
      { ...base, displayName: 'Weak·3', abilities: abilities(45), studentId: 12 },
    ];
    const input = rankingInput({
      teams: [{ teamId: 'home', side: 'HOME', userId: 1, members }, npcTeam('npc:0', participant('NPC', 20))],
      problems: [
        question({ instanceId: 'shared#0', index: 0 }),
        question({ instanceId: 'shared#1', index: 1, dimension: 'DP' }),
      ],
      durationMin: 240,
    });
    const report = simulateRanking(input, 11);
    const timelines = memberTimelines(report, 0);

    // 前提：同一道题确实被多名队员作答，否则「不重复计分」无从验证
    const attemptsPerProblem = new Map<string, number>();
    for (const timeline of timelines) {
      for (const attempt of timeline.attempts) {
        attemptsPerProblem.set(
          attempt.problemInstanceId,
          (attemptsPerProblem.get(attempt.problemInstanceId) ?? 0) + 1,
        );
      }
    }
    expect(Math.max(...attemptsPerProblem.values())).toBeGreaterThan(1);

    const bestPerProblem = new Map<string, number>();
    for (const timeline of timelines) {
      for (const attempt of timeline.attempts) {
        const incumbent = bestPerProblem.get(attempt.problemInstanceId) ?? -1;
        bestPerProblem.set(
          attempt.problemInstanceId,
          Math.max(incumbent, attempt.resolution.scoreAwarded),
        );
      }
    }
    const expectedTeamScore = [...bestPerProblem.values()].reduce(
      (total, score) => total + score,
      0,
    );

    const homeStanding = report.standings.find((standing) => standing.teamIndex === 0);
    expect(homeStanding?.totalScore).toBe(expectedTeamScore);
    // 多人做同一题 → 队内成绩之和必然大于入账的队伍总分，证明没有重复计分
    expect(memberScoreSum(report, 0)).toBeGreaterThan(expectedTeamScore);
    expect(homeStanding?.totalScore).toBeLessThanOrEqual(memberScoreSum(report, 0));
  });

  it('uses score, AC time, and stable team index as the complete standings key', () => {
    const tied = rankingInput({
      teams: [
        homeTeam(participant('First', 50, 0)),
        npcTeam('npc:0', participant('Second', 50, 0)),
        npcTeam('npc:1', participant('Third', 50, 0)),
      ],
    });

    expect(simulateRanking(tied, 5).standings).toEqual([
      { teamIndex: 0, totalScore: 0, rank: 1 },
      { teamIndex: 1, totalScore: 0, rank: 2 },
      { teamIndex: 2, totalScore: 0, rank: 3 },
    ]);
  });

  it('breaks equal priorities by instanceId code-unit order before source position', () => {
    const report = simulateRanking(
      rankingInput({
        teams: teams(player()),
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
        teams: teams(player()),
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

  it('uses the fixed rank-eight pass line for the player team', () => {
    expect(isPassingRank(1)).toBe(true);
    expect(isPassingRank(8)).toBe(true);
    expect(isPassingRank(9)).toBe(false);

    const report = simulateRanking(rankingInput(), 9);
    const playerRank = report.standings.find((standing) => standing.teamIndex === 0)?.rank;
    expect(report.pass).toBe(isPassingRank(playerRank ?? Number.POSITIVE_INFINITY));
  });

  it('preserves participant traits as archival data without activating solver hooks', () => {
    const archivedTrait = { traitId: 'participant-precision-hell' };
    const [firstMember, ...restMembers] = homeTeam(player()).members;
    const withTrait = simulateRanking(
      rankingInput({
        teams: [
          {
            ...homeTeam(player()),
            members: [{ ...firstMember!, traits: [archivedTrait] }, ...restMembers],
          },
          npcTeam('npc:0', participant('NPC', 50)),
        ],
      }),
      29,
    );
    const withoutTrait = simulateRanking(rankingInput({ teams: teams(player()) }), 29);

    expect(withTrait.inputSnapshot.teams[0]?.members[0]?.traits).toEqual([archivedTrait]);
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

  it('replays identical team reports for a fixed seed', () => {
    const input = rankingInput();
    const first = simulateRanking(input, 31);
    const second = simulateRanking(input, 31);

    expect(second).toEqual(first);
    expect(second.snapshotHash).toBe(first.snapshotHash);
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

  it.each([2, TEAM_SIZE_MAX + 1])('rejects teams fielding %s members', (size) => {
    const input = rankingInput({
      teams: [homeTeam(player(), size), npcTeam('npc:0', participant('NPC', 50), size)],
    });

    expect(rankingInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects teams with mismatched roster sizes', () => {
    const input = rankingInput({
      teams: [homeTeam(player(), 3), npcTeam('npc:0', participant('NPC', 50), 4)],
    });

    expect(rankingInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects a second HOME team and duplicated team ids', () => {
    const secondHome = rankingInput({
      teams: [homeTeam(player()), { ...npcTeam('npc:0', participant('NPC', 50)), side: 'HOME' }],
    });
    const duplicateIds = rankingInput({
      teams: [homeTeam(player()), npcTeam('home', participant('NPC', 50))],
    });

    expect(rankingInputSchema.safeParse(secondHome).success).toBe(false);
    expect(rankingInputSchema.safeParse(duplicateIds).success).toBe(false);
  });

  it('enforces ability values from 1 to 100 while mindset remains from -10 to 10', () => {
    for (const ability of [1, 100]) {
      expect(() =>
        simulateRanking(rankingInput({ teams: teams(participant('Player', ability)) }), 1),
      ).not.toThrow();
    }
    for (const ability of [0, 101]) {
      expect(() =>
        simulateRanking(rankingInput({ teams: teams(participant('Player', ability)) }), 1),
      ).toThrow();
    }
    for (const mindset of [-10, 10]) {
      expect(() =>
        simulateRanking(rankingInput({ teams: teams({ ...player(), mindset }) }), 1),
      ).not.toThrow();
    }
    for (const mindset of [-11, 11]) {
      expect(() =>
        simulateRanking(rankingInput({ teams: teams({ ...player(), mindset }) }), 1),
      ).toThrow();
    }
  });

  it('rejects non-finite snapshots and malformed frozen hooks', () => {
    const badParticipant = rankingInput({
      teams: teams({ ...player(), abilities: { ...player().abilities, DS: Number.NaN } }),
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
  it('keeps the stronger team within explicit bounds across 64 seeds', () => {
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
      teams: [homeTeam(participant('Weak', 20)), npcTeam('npc:0', participant('Strong', 95))],
      problems: sampleQuestions,
      durationMin: 240,
    });
    let weakRankTotal = 0;
    let strongRankTotal = 0;
    let strongWins = 0;

    for (let seed = 0; seed < 64; seed += 1) {
      const standings = simulateRanking(input, seed).standings;
      const weakRank = standings.find((standing) => standing.teamIndex === 0)?.rank ?? 0;
      const strongRank = standings.find((standing) => standing.teamIndex === 1)?.rank ?? 0;
      weakRankTotal += weakRank;
      strongRankTotal += strongRank;
      if (strongRank < weakRank) strongWins += 1;
    }

    expect(strongWins).toBeGreaterThanOrEqual(56);
    expect(strongRankTotal / 64).toBeLessThanOrEqual(1.125);
    expect(weakRankTotal / 64).toBeGreaterThanOrEqual(1.875);
  });
});
