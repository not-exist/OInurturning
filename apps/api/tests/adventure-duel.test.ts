import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { chooseAdventure, drawAdventure } from '../src/modules/adventure/service.js';
import { resetUsers } from './helpers.js';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const dataDir = path.resolve(import.meta.dirname, '../../../docs/data');
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/config');
const tempDirs: string[] = [];

function duelEventYaml(partySize: number): string {
  return `version: 0.1.0
events:
  - id: evt-test-duel-available
    code: G1
    name: 测试对决
    category: duel
    rarity: gray
    stamina_cost: 1
    repeatable: true
    cooldown_days: 0
    weight: 100
    requirements: null
    description: 测试用对决事件。
    choices:
      - text: 应战
        outcomes:
          - weight: 100
            type: duel
            duel: { opponent: random_common, party_size: ${partySize}, quality_rule: false, tiebreak: friendly }
            rewards_win: { money: 10 }
            rewards_lose: { money: 1 }
            rewards_draw: { money: 5 }
`;
}

function writeConfigDir(eventsYaml: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'oinur-duel-'));
  tempDirs.push(dir);
  for (const file of ['talents', 'items', 'economy', 'problems', 'stages']) {
    copyFileSync(path.join(dataDir, `${file}.yaml`), path.join(dir, `${file}.yaml`));
  }
  writeFileSync(path.join(dir, 'events.yaml'), eventsYaml);
  return dir;
}

async function createStudent(userId: number, strong = false): Promise<number> {
  const student = await prisma.student.create({
    data: {
      userId,
      name: '对决学员',
      sex: 'MALE',
      qualityTier: 'ELITE',
      ds: strong ? 100 : 35,
      dp: strong ? 100 : 35,
      math: strong ? 100 : 35,
      graph: strong ? 100 : 35,
      greedy: strong ? 100 : 35,
      str: strong ? 100 : 35,
      code: strong ? 100 : 40,
      thinking: strong ? 100 : 40,
      setting: strong ? 100 : 25,
      mindset: 2,
      focusCap: 50,
      energyMax: 100,
      energy: 100,
      stamina: 2,
      staminaRegen: 50,
      lastSettledAt: NOW,
    },
  });
  return student.id;
}

/** 历练对决固定 3 人：HOME = 玩家队伍，AWAY = 同人数 NPC。 */
async function createRoster(userId: number, strong = false): Promise<number[]> {
  return [
    await createStudent(userId, strong),
    await createStudent(userId, strong),
    await createStudent(userId, strong),
  ];
}

async function energyOf(studentId: number): Promise<number> {
  return (await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).energy;
}

describe('M3 duel adventure integration', () => {
  beforeEach(async () => {
    await resetUsers();
    await importConfigs();
  });

  afterAll(async () => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    await importConfigs({ configDir: FIXTURES });
  });

  it('resolves a duel outcome through DuelReport and links its ContestRecord', async () => {
    const user = await prisma.user.create({
      data: { username: `duel-${Date.now().toString(36)}`, money: 0, reputation: 0 },
    });
    const roster = await createRoster(user.id);
    const log = await prisma.adventureLog.create({
      data: {
        userId: user.id,
        studentId: roster[0],
        studentIds: roster,
        eventId: 'evt-g2-duel-passerby',
        tier: 1,
        seed: 12345,
        choices: [],
        results: [],
      },
    });

    const result = await chooseAdventure(user.id, log.id, { optionIndex: 0 }, NOW);
    const stored = await prisma.adventureLog.findUniqueOrThrow({ where: { id: log.id } });
    const record = await prisma.contestRecord.findUniqueOrThrow({
      where: { id: stored.contestRecordId! },
    });

    expect(result.completed).toBe(true);
    expect(result.replay).toMatchObject({
      recordId: record.id,
      format: 'DUEL',
    });
    expect(result.replay?.events.at(-1)?.type).toBe('BATTLE_FINISH');
    expect(stored.contestRecordId).toBeTruthy();
    expect(record.type).toBe('ADVENTURE');
    expect(record.format).toBe('DUEL');
    expect(record.report).toMatchObject({ format: 'DUEL', inputSnapshot: { qualityRuleOn: false } });
    expect(result.adventure.results[0]).toMatchObject({
      outcomeType: 'duel',
      contestRecordId: record.id,
    });
    const report = record.report as unknown as {
      rounds: { answererSide: string; answererMemberIndex: number; energyCost: number }[];
      inputSnapshot: {
        home: { members: { studentId: number | null; side: string }[] };
        away: { members: { side: string }[] };
      };
    };
    // 3 人队伍 → 2N = 6 局，HOME 三人各答一题
    expect(report.rounds).toHaveLength(6);
    expect(report.inputSnapshot.home.members.map((member) => member.studentId)).toEqual(roster);
    expect(report.inputSnapshot.home.members.every((member) => member.side === 'HOME')).toBe(true);
    expect(report.inputSnapshot.away.members).toHaveLength(3);
    expect(report.inputSnapshot.away.members.every((member) => member.side === 'AWAY')).toBe(true);
    expect(new Set(report.rounds.filter((round) => round.answererSide === 'HOME').map((round) => round.answererMemberIndex))).toEqual(
      new Set([0, 1, 2]),
    );
    // 每名参战学员只扣自己答题那一局的精力
    const expected = roster.map((_, index) =>
      100 - report.rounds
        .filter((round) => round.answererSide === 'HOME' && round.answererMemberIndex === index)
        .reduce((total, round) => total + round.energyCost, 0),
    );
    expect(await energyOf(roster[0]!)).toBe(expected[0]);
    expect(await energyOf(roster[1]!)).toBe(expected[1]);
    expect(await energyOf(roster[2]!)).toBe(expected[2]);
    expect(expected.every((value) => value < 100)).toBe(true);
  });

  it('marks a three-person duel choice available', async () => {
    const user = await prisma.user.create({ data: { username: `duel-avail-${Date.now().toString(36)}` } });
    const roster = await createRoster(user.id);

    await importConfigs({ configDir: writeConfigDir(duelEventYaml(3)) });
    const drawn = await drawAdventure(user.id, roster, 1, NOW);
    expect(drawn.event.choices).toEqual([{ index: 0, text: '应战', available: true }]);
  });

  it('resolves R4 and materializes a winning bank_add into the player library', async () => {
    const user = await prisma.user.create({
      data: { username: `r4-${Date.now().toString(36)}`, money: 0, reputation: 0 },
    });
    const roster = await createRoster(user.id);
    const log = await prisma.adventureLog.create({
      data: {
        userId: user.id,
        studentId: roster[0],
        studentIds: roster,
        eventId: 'evt-r4-oj-commission',
        tier: 2,
        seed: 98765,
        choices: [],
        results: [],
      },
    });

    const result = await chooseAdventure(user.id, log.id, { optionIndex: 0 }, NOW);
    const stored = await prisma.adventureLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(stored.contestRecordId).toBeTruthy();
    expect(result.adventure.results[0]).toMatchObject({ outcomeType: 'duel' });
    const generated = await prisma.problemLibraryEntry.findMany({ where: { userId: user.id } });
    const resultRewards = result.adventure.results[0] as { rewards?: { type?: string }[] };
    if (resultRewards.rewards?.some((reward) => reward.type === 'bank_problem')) {
      expect(generated).toHaveLength(1);
    } else {
      expect(generated).toHaveLength(0);
    }
  });

  it('materializes a fixed L3 bank_add outcome into multiple available entries', async () => {
    const user = await prisma.user.create({
      data: { username: `l3-${Date.now().toString(36)}`, money: 0, reputation: 0 },
    });
    const roster = await createRoster(user.id);
    const log = await prisma.adventureLog.create({
      data: {
        userId: user.id,
        studentId: roster[0],
        studentIds: roster,
        eventId: 'evt-l3-lost-problemset',
        tier: 2,
        seed: 54321,
        choices: [],
        results: [],
      },
    });

    await chooseAdventure(user.id, log.id, { optionIndex: 0 }, NOW);
    const generated = await prisma.problemLibraryEntry.findMany({ where: { userId: user.id } });
    expect(generated.length).toBeGreaterThanOrEqual(2);
    expect(generated.length).toBeLessThanOrEqual(3);
    expect(generated.every((entry) => entry.quality >= 65 && entry.quality <= 85)).toBe(true);
  });

  it('adds P5 same-day win streak money after a prior HOME win', async () => {
    let foundBonus = false;
    for (let seed = 1; seed <= 16 && !foundBonus; seed += 1) {
      const user = await prisma.user.create({
        data: { username: `p5-${seed}-${Date.now().toString(36)}`, money: 0, reputation: 0 },
      });
      const roster = await createRoster(user.id, true);
      await prisma.adventureLog.create({
        data: {
          userId: user.id,
          studentId: roster[0],
          studentIds: roster,
          eventId: 'evt-p5-midnight-mystery-contest',
          tier: 3,
          seed: 1,
          status: 'RESOLVED',
          choices: [0],
          results: [{ status: 'RESOLVED', duelWinnerSide: 'HOME' }],
          createdAt: new Date(NOW.getTime() - 1_000),
          resolvedAt: new Date(NOW.getTime() - 1_000),
        },
      });
      const current = await prisma.adventureLog.create({
        data: {
          userId: user.id,
          studentId: roster[0],
          studentIds: roster,
          eventId: 'evt-p5-midnight-mystery-contest',
          tier: 3,
          seed,
          choices: [],
          results: [],
          createdAt: NOW,
        },
      });
      const result = await chooseAdventure(user.id, current.id, { optionIndex: 0 }, NOW);
      const rewards = (result.adventure.results[0] as { rewards?: { type?: string; amount?: number; streak?: number }[] }).rewards ?? [];
      foundBonus = rewards.some((reward) => reward.type === 'win_streak_bonus' && reward.amount === 500 && reward.streak === 2);
    }
    expect(foundBonus).toBe(true);
  });
});
