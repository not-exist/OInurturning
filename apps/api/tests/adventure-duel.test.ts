import { beforeEach, describe, expect, it } from 'vitest';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { chooseAdventure } from '../src/modules/adventure/service.js';
import { resetUsers } from './helpers.js';

const NOW = new Date('2026-09-02T12:00:00.000Z');

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

describe('M3 duel adventure integration', () => {
  beforeEach(async () => {
    await resetUsers();
    await importConfigs();
  });

  it('resolves a duel outcome through DuelReport and links its ContestRecord', async () => {
    const user = await prisma.user.create({
      data: { username: `duel-${Date.now().toString(36)}`, money: 0, reputation: 0 },
    });
    const studentId = await createStudent(user.id);
    const log = await prisma.adventureLog.create({
      data: {
        userId: user.id,
        studentId,
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
    expect(stored.contestRecordId).toBeTruthy();
    expect(record.type).toBe('ADVENTURE');
    expect(record.format).toBe('DUEL');
    expect(record.report).toMatchObject({ format: 'DUEL', inputSnapshot: { qualityRuleOn: false } });
    expect(result.adventure.results[0]).toMatchObject({
      outcomeType: 'duel',
      contestRecordId: record.id,
    });
    expect((record.report as { rounds: unknown[] }).rounds.length).toBeGreaterThanOrEqual(4);
  });

  it('resolves R4 and materializes a winning bank_add into the player library', async () => {
    const user = await prisma.user.create({
      data: { username: `r4-${Date.now().toString(36)}`, money: 0, reputation: 0 },
    });
    const studentId = await createStudent(user.id);
    const log = await prisma.adventureLog.create({
      data: {
        userId: user.id,
        studentId,
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
    const studentId = await createStudent(user.id);
    const log = await prisma.adventureLog.create({
      data: {
        userId: user.id,
        studentId,
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
      const studentId = await createStudent(user.id, true);
      await prisma.adventureLog.create({
        data: {
          userId: user.id,
          studentId,
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
          studentId,
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
