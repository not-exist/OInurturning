import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { importConfigs } from '../src/config/loader.js';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import {
  chooseAdventure,
  drawAdventure,
  listAdventureLogs,
  type AdventureLogView,
} from '../src/modules/adventure/service.js';
import { useItem } from '../src/modules/items/service.js';
import { resetUsers, unwrapOk } from './helpers.js';

const dataDir = path.resolve(import.meta.dirname, '../../../docs/data');
const tempDirs: string[] = [];
let userSequence = 0;
const TEST_NOW = new Date('2026-09-02T12:00:00.000Z');
const app = createApp();

const EVENT_YAML = `version: 0.1.0
events:
  - id: evt-test-adventure
    code: G1
    name: 测试历练
    category: windfall
    rarity: gray
    stamina_cost: 1
    repeatable: true
    cooldown_days: 0
    weight: 100
    requirements: null
    description: 测试用历练事件。
    choices:
      - text: 收下奖励
        outcomes:
          - weight: 100
            type: fixed
            rewards:
              money: 25
              stat_gain: { mindset: 1 }
              buffs: [{ target: next_training, stat: any, bonus: 0.2, duration: 1 }]
  - id: evt-test-check
    code: G2
    name: 测试检定
    category: trial
    rarity: yellow
    stamina_cost: 2
    repeatable: true
    cooldown_days: 0
    weight: 100
    requirements: null
    description: 测试用检定事件。
    choices:
      - text: 接受检定
        outcomes:
          - weight: 100
            type: check
            check: { skill: code, dc: 0 }
            rewards_success: { reputation: 3 }
            rewards_fail: { reputation: -2 }
`;

function writeConfigDir(eventsYaml = EVENT_YAML): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'oinur-adventure-'));
  tempDirs.push(dir);
  for (const file of ['talents', 'items', 'economy', 'problems', 'stages']) {
    copyFileSync(path.join(dataDir, `${file}.yaml`), path.join(dir, `${file}.yaml`));
  }
  writeFileSync(path.join(dir, 'events.yaml'), eventsYaml);
  return dir;
}

async function createUser(money = 0, reputation = 0): Promise<number> {
  userSequence += 1;
  const user = await prisma.user.create({ data: { username: `adv-${userSequence}-${Date.now().toString(36)}`, money, reputation } });
  return user.id;
}

async function createStudent(userId: number, stamina = 2): Promise<number> {
  const student = await prisma.student.create({
    data: {
      userId,
      name: '历练学员',
      sex: 'MALE',
      qualityTier: 'COMMON',
      ds: 10,
      dp: 10,
      math: 10,
      graph: 10,
      greedy: 10,
      str: 10,
      code: 30,
      thinking: 20,
      setting: 5,
      mindset: 2,
      focusCap: 45,
      energyMax: 60,
      energy: 30,
      stamina,
      staminaRegen: 50,
      lastSettledAt: TEST_NOW,
    },
  });
  return student.id;
}

describe('M3 adventure API service', () => {
  beforeEach(async () => {
    await resetUsers();
    await importConfigs({ configDir: writeConfigDir() });
  });

  afterAll(async () => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    await importConfigs({ configDir: path.resolve(import.meta.dirname, 'fixtures/config') });
  });

  it('draws a pending event, settles stamina, applies fixed rewards and stores buffs', async () => {
    const userId = await createUser(10);
    const studentId = await createStudent(userId);
    const drawn = await drawAdventure(userId, studentId, 1, TEST_NOW);

    expect(drawn.status).toBe('PENDING');
    expect(drawn.event.id).toBe('evt-test-adventure');
    expect(drawn.event.choices).toEqual([{ index: 0, text: '收下奖励', available: true }]);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).stamina).toBe(1);

    const result = await chooseAdventure(userId, drawn.id, { optionIndex: 0 }, new Date(TEST_NOW.getTime() + 60_000));
    expect(result.completed).toBe(true);
    expect(result.adventure.results[0]).toMatchObject({ outcomeType: 'fixed' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).money).toBe(35);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).mindset).toBe(3);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).counters).toMatchObject({
      adventureBuffs: [{ target: 'next_training', duration: 1 }],
    });
  });

  it('settles a scalar check with the student and talent-adjusted score', async () => {
    const userId = await createUser(0, 0);
    const studentId = await createStudent(userId);
    const log = await prisma.adventureLog.create({
      data: { userId, studentId, eventId: 'evt-test-check', tier: 2, seed: 7, choices: [], results: [] },
    });

    const result = await chooseAdventure(userId, log.id, { optionIndex: 0 }, TEST_NOW);
    expect(result.adventure.results[0]).toMatchObject({
      outcomeType: 'check',
      check: { skill: 'code', dc: 0, score: 30, success: true },
      rewards: [{ type: 'reputation', amount: 3 }],
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).reputation).toBe(3);
  });

  it('supports intel activation, preview, avoid without stamina, and accept with stamina', async () => {
    const userId = await createUser();
    const studentId = await createStudent(userId);
    await prisma.userItem.create({ data: { userId, itemId: 'intel-slip', quantity: 1 } });
    await useItem(userId, { itemId: 'intel-slip' });

    const preview = await drawAdventure(userId, studentId, 1, TEST_NOW);
    expect(preview.preview).toBe(true);
    expect(preview.event.choices).toBeNull();
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).stamina).toBe(2);

    const avoided = await chooseAdventure(userId, preview.id, { action: 'avoid' }, TEST_NOW);
    expect(avoided.completed).toBe(true);
    expect(avoided.adventure.results[0]).toEqual({ status: 'AVOIDED' });
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).stamina).toBe(2);

    await prisma.userItem.create({ data: { userId, itemId: 'intel-slip', quantity: 1 } });
    await useItem(userId, { itemId: 'intel-slip' });
    const secondPreview = await drawAdventure(userId, studentId, 1, TEST_NOW);
    const accepted = await chooseAdventure(userId, secondPreview.id, { action: 'accept' }, TEST_NOW);
    expect(accepted.completed).toBe(false);
    expect(accepted.adventure.event.choices).toEqual([{ index: 0, text: '收下奖励', available: true }]);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).stamina).toBe(1);
    await chooseAdventure(userId, secondPreview.id, { optionIndex: 0 }, TEST_NOW);
  });

  it('blocks a second draw while pending and exposes only owner logs', async () => {
    const userId = await createUser();
    const otherUserId = await createUser();
    const studentId = await createStudent(userId);
    const drawn = await drawAdventure(userId, studentId, 1, TEST_NOW);

    await expect(drawAdventure(userId, studentId, 1)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(listAdventureLogs(otherUserId)).resolves.toEqual([]);
    await expect(chooseAdventure(otherUserId, drawn.id, { optionIndex: 0 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('exposes authenticated draw, choice and log routes', async () => {
    const username = `route-${userSequence + 1}-${Date.now().toString(36)}`;
    const registration = await request(app)
      .post('/api/auth/register')
      .send({ username, password: 'pw-123456' });
    const session = unwrapOk<{ accessToken: string; me: { id: number } }>(registration);
    const studentId = await createStudent(session.me.id);
    const headers = { Authorization: `Bearer ${session.accessToken}` };

    const drawn = await request(app)
      .post('/api/adventures/draw')
      .set(headers)
      .send({ studentId, tier: 1 });
    expect(drawn.status).toBe(200);
    const adventure = unwrapOk<AdventureLogView>(drawn);
    const chosen = await request(app)
      .post(`/api/adventures/${adventure.id}/choice`)
      .set(headers)
      .send({ optionIndex: 0 });
    expect(chosen.status).toBe(200);
    expect(unwrapOk<{ completed: boolean }>(chosen).completed).toBe(true);

    const logs = await request(app).get('/api/adventures/logs').set(headers);
    expect(logs.status).toBe(200);
    expect(unwrapOk<AdventureLogView[]>(logs)).toHaveLength(1);
  });
});
