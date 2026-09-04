import { beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { enterStoryStage } from '../src/modules/story/service.js';
import { resetUsers } from './helpers.js';

async function createStudent(userId: number): Promise<number> {
  const student = await prisma.student.create({
    data: {
      userId,
      name: 'Reward Student',
      sex: 'FEMALE',
      qualityTier: 'ELITE',
      ds: 100,
      dp: 100,
      math: 100,
      graph: 100,
      greedy: 100,
      str: 100,
      code: 100,
      thinking: 100,
      setting: 100,
      mindset: 10,
      focusCap: 30,
      energyMax: 100,
      energy: 100,
      stamina: 5,
      staminaRegen: 50,
    },
  });
  return student.id;
}

describe('story rewards and retries', () => {
  beforeEach(resetUsers);

  it('deducts stamina once per entry, awards first clear once, and records repeats', async () => {
    await importConfigs({ configDir: path.resolve(import.meta.dirname, 'fixtures/config') });
    const user = await prisma.user.create({ data: { username: 'story-rewards' } });
    const studentId = await createStudent(user.id);

    const first = await enterStoryStage(user.id, 'cspj:1', 0, [studentId], 'reward-entry-1');
    expect(first.replayed).toBe(false);
    expect(first.firstClear).toBe(true);
    expect(first.record.rewards).toEqual(
      expect.arrayContaining([
        { type: 'first_clear_money', amount: 1 },
        { type: 'milestone_item', itemId: 'rename-card', count: 1 },
      ]),
    );

    const afterFirst = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    const userAfterFirst = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(afterFirst.stamina).toBe(4);
    expect(userAfterFirst.money).toBe(1);

    const second = await enterStoryStage(user.id, 'cspj:1', 0, [studentId], 'reward-entry-2');
    expect(second.firstClear).toBe(false);
    const afterSecond = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(afterSecond.stamina).toBeCloseTo(3, 3);
    expect(
      await prisma.storyProgress.count({ where: { userId: user.id, stageKey: 'cspj:1' } }),
    ).toBe(1);
    expect(
      (await prisma.storyProgress.findFirstOrThrow({ where: { userId: user.id } })).clearCount,
    ).toBe(2);
  });
});
