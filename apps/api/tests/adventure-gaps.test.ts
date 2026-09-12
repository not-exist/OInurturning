import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { importConfigs } from '../src/config/loader.js';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { chooseAdventure, drawAdventure, listAdventureLogs } from '../src/modules/adventure/service.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 历练补白（adventure.test.ts 覆盖固定奖励/检定/情报/pending/HTTP 主路径）：
 * draw 参数校验、选项校验、requires_item/cost_money/energy_cost 门槛、
 * RESOLVED 幂等、日志上限与倒序。沿用 adventure.test.ts 的自定义 events 写法，
 * 每测单事件配置保证抽卡确定性，事后恢复 fixtures。
 */
const app: Express = createApp();
const dataDir = path.resolve(import.meta.dirname, '../../../docs/data');
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/config');
const tempDirs: string[] = [];
let seq = 0;

function eventYaml(id: string, code: string, choices: string): string {
  return `version: 0.1.0
events:
  - id: ${id}
    code: ${code}
    name: 补白事件
    category: windfall
    rarity: gray
    stamina_cost: 1
    repeatable: true
    cooldown_days: 0
    weight: 100
    requirements: null
    description: 补白用单事件。
    choices:
${choices}`;
}

const FIXED_CHOICES = `      - text: 收下十金
        outcomes:
          - weight: 100
            type: fixed
            rewards:
              money: 10
`;
const ITEM_CHOICES = `      - text: 需改名卡
        requires_item: rename-card
        outcomes:
          - weight: 100
            type: fixed
            rewards:
              money: 50
`;
const COST_CHOICES = `      - text: 付费四十
        cost_money: 40
        outcomes:
          - weight: 100
            type: fixed
            rewards:
              money: 100
`;
const ENERGY_CHOICES = `      - text: 耗五十精力
        outcomes:
          - weight: 100
            type: fixed
            rewards:
              energy_cost: 50
              money: 5
`;

function writeConfigDir(eventsYaml: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'oinur-advgap-'));
  tempDirs.push(dir);
  for (const file of ['talents', 'items', 'economy', 'problems', 'stages']) {
    copyFileSync(path.join(dataDir, `${file}.yaml`), path.join(dir, `${file}.yaml`));
  }
  writeFileSync(path.join(dir, 'events.yaml'), eventsYaml);
  return dir;
}

async function useEvents(eventsYaml: string): Promise<void> {
  await importConfigs({ configDir: writeConfigDir(eventsYaml) });
}

beforeEach(async () => {
  await resetUsers();
  await useEvents(eventYaml('evt-gap-fixed', 'G1', FIXED_CHOICES));
});

afterAll(async () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  await importConfigs({ configDir: FIXTURES });
});

async function register(): Promise<{ token: string; userId: number }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `advgap-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { token: session.accessToken, userId: session.me.id };
}

async function makeStudent(userId: number, stamina = 5): Promise<{ id: number }> {
  const student = await prisma.student.create({
    data: {
      userId, name: '历练学员', sex: 'MALE', qualityTier: 'COMMON',
      ds: 10, dp: 10, math: 10, graph: 10, greedy: 10, str: 10, code: 10, thinking: 10, setting: 10,
      focusCap: 20, energyMax: 60, energy: 30, stamina, staminaRegen: 10,
    },
  });
  return { id: student.id };
}

describe('adventure gaps：抽卡与选项校验', () => {
  it('draw 校验：tier 越界/体力不足/归属', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const badTier = await request(app).post('/api/adventures/draw').set(auth).send({ studentId: student.id, tier: 4 });
    expect(badTier.status).toBe(400);
    const zeroTier = await request(app).post('/api/adventures/draw').set(auth).send({ studentId: student.id, tier: 0 });
    expect(zeroTier.status).toBe(400);

    await prisma.student.update({ where: { id: student.id }, data: { stamina: 0 } });
    const poor = await request(app).post('/api/adventures/draw').set(auth).send({ studentId: student.id, tier: 1 });
    expect(poor.status).toBe(409);
    expect(unwrapErr(poor).code).toBe('INSUFFICIENT_RESOURCE');

    const other = await register();
    const foreign = await request(app).post('/api/adventures/draw').set(auth).send({ studentId: (await makeStudent(other.userId)).id, tier: 1 });
    expect(foreign.status).toBe(403);
    const missing = await request(app).post('/api/adventures/draw').set(auth).send({ studentId: 99999999, tier: 1 });
    expect(missing.status).toBe(404);
  });

  it('PENDING 未决 → 二次 draw 409（HTTP）', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const first = await request(app).post('/api/adventures/draw').set(auth).send({ studentId: student.id, tier: 1 });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/adventures/draw').set(auth).send({ studentId: student.id, tier: 1 });
    expect(second.status).toBe(409);
    expect(unwrapErr(second).code).toBe('STATE_CONFLICT');
  });

  it('选项校验：越界 index → 400；他人冒险 → 404', async () => {
    const user = await register();
    const other = await register();
    const student = await makeStudent(user.userId);
    const drawn = unwrapOk<{ id: number }>(
      await request(app).post('/api/adventures/draw').set('Authorization', `Bearer ${user.token}`).send({ studentId: student.id, tier: 1 }),
    );
    const badIndex = await request(app)
      .post(`/api/adventures/${drawn.id}/choice`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ optionIndex: 7 });
    expect(badIndex.status).toBe(400);
    const foreign = await request(app)
      .post(`/api/adventures/${drawn.id}/choice`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ optionIndex: 0 });
    expect(foreign.status).toBe(404);
  });
});

describe('adventure gaps：选项门槛', () => {
  it('requires_item 缺道具 → 409；持有 → 结算', async () => {
    await useEvents(eventYaml('evt-gap-item', 'G2', ITEM_CHOICES));
    const user = await register();
    const student = await makeStudent(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const drawn = unwrapOk<{ id: number }>(
      await request(app).post('/api/adventures/draw').set(auth).send({ studentId: student.id, tier: 1 }),
    );
    const lacking = await request(app).post(`/api/adventures/${drawn.id}/choice`).set(auth).send({ optionIndex: 0 });
    expect(lacking.status).toBe(409);
    expect(unwrapErr(lacking)).toMatchObject({ code: 'INSUFFICIENT_RESOURCE' });

    await prisma.userItem.create({ data: { userId: user.userId, itemId: 'rename-card', quantity: 1 } });
    const ok = await request(app).post(`/api/adventures/${drawn.id}/choice`).set(auth).send({ optionIndex: 0 });
    expect(ok.status).toBe(200);
    expect(unwrapOk<{ completed: boolean }>(ok).completed).toBe(true);
    // requires_item 仅门槛不消耗
    expect(await prisma.userItem.findUnique({ where: { userId_itemId: { userId: user.userId, itemId: 'rename-card' } } })).not.toBeNull();
  });

  it('cost_money 缺钱 → 409；足额 → 净收支到账', async () => {
    await useEvents(eventYaml('evt-gap-cost', 'G3', COST_CHOICES));
    const user = await register();
    await prisma.user.update({ where: { id: user.userId }, data: { money: 0 } }); // 开局包 1000 金归零，还原缺钱前置
    const student = await makeStudent(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const drawn = unwrapOk<{ id: number }>(
      await request(app).post('/api/adventures/draw').set(auth).send({ studentId: student.id, tier: 1 }),
    );
    const lacking = await request(app).post(`/api/adventures/${drawn.id}/choice`).set(auth).send({ optionIndex: 0 });
    expect(lacking.status).toBe(409);

    await prisma.user.update({ where: { id: user.userId }, data: { money: 40 } });
    const ok = await request(app).post(`/api/adventures/${drawn.id}/choice`).set(auth).send({ optionIndex: 0 });
    expect(ok.status).toBe(200);
    const me = unwrapOk<{ money: number }>(await request(app).get('/api/users/me').set(auth));
    expect(me.money).toBe(100); // 40 − 40 + 100
  });

  it('energy_cost 超精力 → 409', async () => {
    await useEvents(eventYaml('evt-gap-energy', 'G4', ENERGY_CHOICES));
    const user = await register();
    const student = await makeStudent(user.userId);
    const drawn = unwrapOk<{ id: number }>(
      await request(app).post('/api/adventures/draw').set('Authorization', `Bearer ${user.token}`).send({ studentId: student.id, tier: 1 }),
    );
    const res = await request(app)
      .post(`/api/adventures/${drawn.id}/choice`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ optionIndex: 0 });
    expect(res.status).toBe(409);
    expect(unwrapErr(res)).toMatchObject({ code: 'INSUFFICIENT_RESOURCE' });
  });
});

describe('adventure gaps：幂等与日志', () => {
  it('RESOLVED 后重选 → 幂等 completed，不重发奖励', async () => {
    const user = await register();
    await prisma.user.update({ where: { id: user.userId }, data: { money: 0 } }); // 开局包 1000 金归零（+10 奖励绝对断言口径）
    const student = await makeStudent(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const drawn = unwrapOk<{ id: number }>(
      await request(app).post('/api/adventures/draw').set(auth).send({ studentId: student.id, tier: 1 }),
    );
    const first = await request(app).post(`/api/adventures/${drawn.id}/choice`).set(auth).send({ optionIndex: 0 });
    expect(unwrapOk<{ completed: boolean }>(first).completed).toBe(true);
    const moneyAfterFirst = (await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).money;
    expect(moneyAfterFirst).toBe(10);
    const second = await request(app).post(`/api/adventures/${drawn.id}/choice`).set(auth).send({ optionIndex: 0 });
    expect(second.status).toBe(200);
    expect(unwrapOk<{ completed: boolean }>(second).completed).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).money).toBe(10);
  });

  it('日志上限校验 + 按创建时间倒序', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };
    const zero = await request(app).get('/api/adventures/logs?limit=0').set(auth);
    expect(zero.status).toBe(400);
    const over = await request(app).get('/api/adventures/logs?limit=101').set(auth);
    expect(over.status).toBe(400);

    // drawAdventure 忽略注入的 now（createdAt 取库默认值），同毫秒建行会导致倒序歧义；
    // 此处直写 createdAt 保证确定性（listAdventureLogs 按 createdAt desc 排序）
    seq += 1;
    const direct = await prisma.user.create({ data: { username: `advgap-direct-${Date.now().toString(36)}-${seq}` } });
    const student = await prisma.student.create({
      data: {
        userId: direct.id, name: '直调学员', sex: 'MALE', qualityTier: 'COMMON',
        ds: 10, dp: 10, math: 10, graph: 10, greedy: 10, str: 10, code: 10, thinking: 10, setting: 10,
        focusCap: 20, energyMax: 60, energy: 60, stamina: 5, staminaRegen: 10,
        lastSettledAt: new Date('2026-09-02T11:00:00.000Z'),
      },
    });
    const first = await drawAdventure(direct.id, student.id, 1, new Date('2026-09-02T12:00:00.000Z'));
    await chooseAdventure(direct.id, first.id, { optionIndex: 0 }, new Date('2026-09-02T12:00:01.000Z'));
    const second = await drawAdventure(direct.id, student.id, 1, new Date('2026-09-02T12:00:02.000Z'));
    await prisma.adventureLog.update({ where: { id: first.id }, data: { createdAt: new Date('2026-09-02T12:00:00.000Z') } });
    await prisma.adventureLog.update({ where: { id: second.id }, data: { createdAt: new Date('2026-09-02T12:00:02.000Z') } });
    const logs = await listAdventureLogs(direct.id, 10);
    expect(logs.map((l) => l.id)).toEqual([second.id, first.id]);
  });
});
