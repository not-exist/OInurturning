import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { getConfig, importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 引导服务端锁（PR #61 Critical 面）：
 * - 越界推进：回退步数曾直接穿透并重复发奖（advance(S)/advance(S-1) 交替可无限刷）
 * - complete 曾无前置条件：新号一次 POST /api/tutorial/complete 即全解锁 + 发完所有奖励
 * - 守卫曾用 startsWith 前缀匹配且缺 /api/talents，step0 的概览/学员页直接 403
 * 步数用直连 prisma 写入（人为推进），不依赖业务端点的副作用。
 */
const app: Express = createApp();
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/config');
let seq = 0;

beforeAll(async () => {
  await importConfigs({ configDir: FIXTURES });
});
beforeEach(resetUsers);
afterAll(async () => {
  await importConfigs({ configDir: FIXTURES });
});

async function register(): Promise<{ token: string; userId: number }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `tut-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { token: session.accessToken, userId: session.me.id };
}

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** fixture 步骤表按 id 取序号，避免与 yaml 顺序脱节 */
function stepIndex(id: string): number {
  const steps = getConfig()!.tutorial!.steps;
  const idx = steps.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error(`fixture 缺少引导步骤 ${id}`);
  return idx;
}

async function setStep(userId: number, step: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tutorialStep: step } });
}

async function moneyOf(userId: number): Promise<number> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).money;
}

async function milkTeaOf(userId: number): Promise<number> {
  const item = await prisma.userItem.findUnique({
    where: { userId_itemId: { userId, itemId: 'milk-tea' } },
  });
  return item?.quantity ?? 0;
}

describe('tutorial 服务端锁', () => {
  it('新号业务端点被锁：GET /api/students → 403 tutorial', async () => {
    const user = await register();
    const res = await request(app).get('/api/students').set(auth(user.token));
    expect(res.status).toBe(403);
    expect(unwrapErr(res)).toMatchObject({
      code: 'FORBIDDEN',
      details: { resource: 'tutorial' },
    });
  });

  it('support 与引导自身在 step0 可用：/api/talents、/api/users/me、/api/overview、/api/tutorial → 200', async () => {
    const user = await register();
    const paths = ['/api/talents', '/api/users/me', '/api/overview', '/api/tutorial'];
    for (const p of paths) {
      const res = await request(app).get(p).set(auth(user.token));
      expect(res.status, `${p} 应放行`).toBe(200);
    }
  });

  it('回退步数被拒：advance(1) 成功后重复 advance(0) → 409，金币与道具不增', async () => {
    const user = await register();
    const first = await request(app)
      .post('/api/tutorial/advance')
      .set(auth(user.token))
      .send({ step: stepIndex('students') });
    expect(first.status).toBe(200);
    expect(unwrapOk<{ step: number }>(first).step).toBe(stepIndex('students'));

    const moneyBefore = await moneyOf(user.userId);
    const milkTeaBefore = await milkTeaOf(user.userId);
    for (let i = 0; i < 3; i += 1) {
      const back = await request(app)
        .post('/api/tutorial/advance')
        .set(auth(user.token))
        .send({ step: stepIndex('welcome') });
      expect(back.status, `第 ${i + 1} 次回退应 409`).toBe(409);
      expect(unwrapErr(back)).toMatchObject({ code: 'STATE_CONFLICT' });
    }
    expect(await moneyOf(user.userId)).toBe(moneyBefore);
    expect(await milkTeaOf(user.userId)).toBe(milkTeaBefore);
    const state = unwrapOk<{ step: number }>(
      await request(app).get('/api/tutorial').set(auth(user.token)),
    );
    expect(state.step).toBe(stepIndex('students'));
  });

  it('手动推进不能越过行为步：students 步 advance(2) → 409 且 details.action 为 visit_students', async () => {
    const user = await register();
    await setStep(user.userId, stepIndex('students'));
    const res = await request(app)
      .post('/api/tutorial/advance')
      .set(auth(user.token))
      .send({ step: stepIndex('students') + 1 });
    expect(res.status).toBe(409);
    expect(unwrapErr(res)).toMatchObject({
      code: 'STATE_CONFLICT',
      details: { resource: 'tutorial', action: 'visit_students' },
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).toMatchObject({
      tutorialStep: stepIndex('students'),
      tutorialCompleted: false,
    });
  });

  it('跳步被拒：welcome 步 advance(3) → 409', async () => {
    const user = await register();
    const res = await request(app)
      .post('/api/tutorial/advance')
      .set(auth(user.token))
      .send({ step: stepIndex('academy') });
    expect(res.status).toBe(409);
    expect(unwrapErr(res)).toMatchObject({ code: 'STATE_CONFLICT', details: { resource: 'tutorial' } });
  });

  it('step 越界 → 400 VALIDATION_FAILED', async () => {
    const user = await register();
    const beyond = await request(app)
      .post('/api/tutorial/advance')
      .set(auth(user.token))
      .send({ step: 99 });
    expect(beyond.status).toBe(400);
    expect(unwrapErr(beyond)).toMatchObject({ code: 'VALIDATION_FAILED', details: { resource: 'tutorial' } });
    const negative = await request(app)
      .post('/api/tutorial/advance')
      .set(auth(user.token))
      .send({ step: -1 });
    expect(negative.status).toBe(400);
  });

  it('新号直接 complete → 409（需先完成引导步骤）', async () => {
    const user = await register();
    const res = await request(app).post('/api/tutorial/complete').set(auth(user.token));
    expect(res.status).toBe(409);
    const err = unwrapErr(res);
    expect(err.code).toBe('STATE_CONFLICT');
    expect(JSON.stringify(err.details)).toContain('需先完成引导步骤');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).toMatchObject({
      tutorialCompleted: false,
    });
  });

  it('到达末步后 complete → 200 且末步奖励只发一次', async () => {
    const user = await register();
    await setStep(user.userId, stepIndex('complete'));
    const moneyBefore = await moneyOf(user.userId);
    const first = await request(app).post('/api/tutorial/complete').set(auth(user.token));
    expect(first.status).toBe(200);
    const state = unwrapOk<{ completed: boolean; unlocked: string[] }>(first);
    expect(state.completed).toBe(true);
    expect(state.unlocked).toEqual(['all']);
    const moneyAfterFirst = await moneyOf(user.userId);
    expect(moneyAfterFirst).toBeGreaterThan(moneyBefore);
    const second = await request(app).post('/api/tutorial/complete').set(auth(user.token));
    expect(second.status).toBe(200);
    expect(unwrapOk<{ completed: boolean }>(second).completed).toBe(true);
    expect(await moneyOf(user.userId)).toBe(moneyAfterFirst);
  });

  it('测试环境 skip → 200 全解锁，且跳过后商店可用（不是 403）', async () => {
    const user = await register();
    const skipped = await request(app).post('/api/tutorial/skip').set(auth(user.token));
    expect(skipped.status).toBe(200);
    expect(unwrapOk<{ completed: boolean; unlocked: string[] }>(skipped)).toMatchObject({
      completed: true,
      unlocked: ['all'],
    });
    const catalog = await request(app).get('/api/shop/catalog').set(auth(user.token));
    expect(catalog.status, '跳过引导后商店不应再被锁').not.toBe(403);
    expect(catalog.status).toBe(200);
    expect(unwrapOk<{ items: unknown[] }>(catalog).items.length).toBeGreaterThan(0);
  });

  it('step0 商店仍锁定：GET /api/shop/catalog → 403', async () => {
    const user = await register();
    const res = await request(app).get('/api/shop/catalog').set(auth(user.token));
    expect(res.status).toBe(403);
    expect(unwrapErr(res)).toMatchObject({ code: 'FORBIDDEN', details: { resource: 'tutorial' } });
  });
});
