import { describe, expect, it } from 'vitest';
import type {
  AbilityKey,
  BattleReplay,
  BattleReplayEvent,
  ContestTeam,
  DuelInput,
  ParticipantSnapshot,
  QuestionSnapshot,
  RankingInput,
} from '@oinur/shared';
import { simulateDuel } from '../src/modules/contest/engine/duel.js';
import { simulateRanking } from '../src/modules/contest/engine/ranking.js';
import { buildBattleReplay } from '../src/modules/contest/replay.js';

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

function member(displayName: string): ParticipantSnapshot {
  return {
    side: 'NPC',
    userId: null,
    studentId: null,
    displayName,
    abilities: abilities(60),
    traits: [],
    mindset: 0,
    focusCap: 40,
    energyMax: 100,
  };
}

/** 玩家队：名字写成 `HOME-i`，用于核对回放是否覆盖每一名队员。 */
function homeTeam(size: number): ContestTeam {
  return {
    teamId: 'player',
    side: 'HOME',
    userId: 1,
    members: Array.from({ length: size }, (_, index) => ({
      ...member(`HOME-${index}`),
      side: 'HOME' as const,
      userId: 1,
      studentId: 10 + index,
    })),
  };
}

function awayTeam(size: number): ParticipantSnapshot[] {
  return Array.from({ length: size }, (_, index) => ({
    ...member(`AWAY-${index}`),
    side: 'AWAY' as const,
    userId: 2,
    studentId: 20 + index,
  }));
}

function npcTeam(size: number): ContestTeam {
  return {
    teamId: 'npc:0',
    side: 'NPC',
    userId: null,
    members: Array.from({ length: size }, (_, index) => ({
      ...member(`NPC-${index}`),
      side: 'NPC' as const,
      userId: null,
      studentId: null,
    })),
  };
}

function question(instanceId: string, index: number): QuestionSnapshot {
  return {
    instanceId,
    index,
    dimension: 'DS',
    demand: 50,
    thought: 50,
    codeVolume: 10,
    score: 100,
    quality: 50,
    timeLimitMin: 30,
    partialScores: false,
    traits: [],
    source: 'GENERATED',
  };
}

function eventsOf<T extends BattleReplayEvent['type']>(
  replay: BattleReplay,
  type: T,
): Extract<BattleReplayEvent, { type: T }>[] {
  return replay.events.filter(
    (event): event is Extract<BattleReplayEvent, { type: T }> => event.type === type,
  );
}

describe('battle replay', () => {
  it('ranking 回放覆盖玩家队全部成员，并按队伍结算收尾', () => {
    const teams = [homeTeam(3), npcTeam(3)];
    const input: RankingInput = {
      kind: 'custom',
      teams,
      problems: [question('rank-0', 0), question('rank-1', 1)],
      durationMin: 120,
    };
    const report = simulateRanking(input, 4242);
    const replay = buildBattleReplay('rec-ranking', report, '队伍排名赛');

    const start = eventsOf(replay, 'BATTLE_START')[0]!;
    expect(start.format).toBe('RANKING');
    // 题目看板使用报告快照，但不得把回放展示层暴露为同一份可变引用。
    expect(replay.questions).toEqual(report.questions);
    expect(replay.questions).not.toBe(report.questions);
    expect(replay.questions?.[0]).not.toBe(report.questions[0]);
    // 队名组合全部队员，而不是只显示第一个人
    for (const entry of teams[0]!.members) expect(start.homeName).toContain(entry.displayName);

    // 每名队员都有自己的答题时间线（不能只播队长）
    const answered = new Set(eventsOf(replay, 'QUESTION_START').map((event) => event.participantName));
    expect(answered).toEqual(new Set(['HOME-0', 'HOME-1', 'HOME-2']));

    // memberIndex 在 QUESTION_START / SUBMISSION / QUESTION_RESULT 上均存在
    for (const event of replay.events) {
      if (
        event.type === 'QUESTION_START' ||
        event.type === 'SUBMISSION' ||
        event.type === 'QUESTION_RESULT'
      ) {
        expect(event.memberIndex).toBeTypeOf('number');
        expect(event.memberIndex).toBeGreaterThanOrEqual(0);
        expect(event.memberIndex).toBeLessThan(3);
      }
    }

    // 按阶段并行：同一 phase 的 QUESTION_START 同一时间触发，且成员不重复。
    const qStarts = eventsOf(replay, 'QUESTION_START');
    const phaseOrder = new Map<number, { members: number[]; times: number[] }>();
    for (const event of qStarts) {
      expect(event.phaseIndex).toBeTypeOf('number');
      expect(event.timeMs).toBeTypeOf('number');
      const entry = phaseOrder.get(event.phaseIndex!) ?? { members: [], times: [] };
      entry.members.push(event.memberIndex!);
      entry.times.push(event.timeMs!);
      phaseOrder.set(event.phaseIndex!, entry);
    }
    for (const [, entry] of phaseOrder) {
      expect(new Set(entry.members).size).toBe(entry.members.length);
      expect(new Set(entry.times).size).toBe(1);
    }

    // 事件流按展示时间排序，而不是按「某个成员完整打完再轮到下一个成员」串行排序。
    for (let index = 1; index < replay.events.length; index++) {
      const current = replay.events[index]!;
      const previous = replay.events[index - 1]!;
      const currentTime = 'timeMs' in current ? (current.timeMs ?? 0) : 0;
      const previousTime = 'timeMs' in previous ? (previous.timeMs ?? 0) : 0;
      expect(currentTime).toBeGreaterThanOrEqual(previousTime);
    }

    const finish = eventsOf(replay, 'BATTLE_FINISH')[0]!;
    const standing = report.standings.find((entry) => entry.teamIndex === 0)!;
    expect(finish).toMatchObject({
      rank: standing.rank,
      totalScore: standing.totalScore,
      participantCount: report.teams.length,
    });
  });

  it.each([3, 4])('duel 回放 N=%i：每轮出题者/答题者与 2N 轮换一一对应', (size) => {
    const home = homeTeam(size).members;
    const away = awayTeam(size);
    const input: DuelInput = {
      home: { members: home },
      away: { members: away },
      questions: Array.from({ length: 2 * size }, (_, index) => question(`duel-${index}`, index)),
      qualityRuleOn: false,
      tiebreak: 'FRIENDLY',
    };
    const report = simulateDuel(input, 99);
    const replay = buildBattleReplay('rec-duel', report, '出题对决');

    expect(eventsOf(replay, 'BATTLE_START')[0]!.homeName).toContain('HOME-0');
    expect(eventsOf(replay, 'BATTLE_START')[0]!.awayName).toContain('AWAY-0');

    const starts = eventsOf(replay, 'ROUND_START');
    expect(starts).toHaveLength(2 * size);

    // 第 r 局 k=floor((r-1)/2)：奇数局 HOME[k] 出题、AWAY[k+1] 答题，偶数局反之。
    starts.forEach((event, index) => {
      const setterSide = index % 2 === 0 ? 'HOME' : 'AWAY';
      const k = Math.floor(index / 2) % size;
      const setterRoster = setterSide === 'HOME' ? home : away;
      const answererRoster = setterSide === 'HOME' ? away : home;
      expect(event).toMatchObject({
        setterSide,
        setterName: setterRoster[k]!.displayName,
        participantName: answererRoster[(k + 1) % size]!.displayName,
      });
    });

    // 每名成员恰好出题一次、答题一次（防「只实现 3 人」或下标漂移）
    expect(new Set(starts.map((event) => `${event.setterSide}:${event.setterName}`)).size).toBe(2 * size);
    expect(new Set(starts.map((event) => event.participantName)).size).toBe(2 * size);
  });
});
