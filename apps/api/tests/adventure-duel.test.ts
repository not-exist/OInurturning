import { beforeEach, describe, expect, it } from 'vitest';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { chooseAdventure } from '../src/modules/adventure/service.js';
import { resetUsers } from './helpers.js';

const NOW = new Date('2026-09-02T12:00:00.000Z');

async function createStudent(userId: number): Promise<number> {
  const student = await prisma.student.create({
    data: {
      userId,
      name: '对决学员',
      sex: 'MALE',
      qualityTier: 'ELITE',
      ds: 35,
      dp: 35,
      math: 35,
      graph: 35,
      greedy: 35,
      str: 35,
      code: 40,
      thinking: 40,
      setting: 25,
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
});
