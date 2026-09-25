import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { getConfig, importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapOk } from './helpers.js';

/**
 * visit_* 引导步的推进位置：
 * GET /api/overview 内部会调 listStudents() 与 getPool()，若钩子挂在 service 上，
 * 用户只要打开总览页就会把「访问学员 / 访问学院」两步过掉，spotlight 形同虚设。
 * 因此这两步只允许由各自的端点（GET /api/students、GET /api/academy/pool）推进。
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
    .send({ username: `tut-hook-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { token: session.accessToken, userId: session.me.id };
}

/** 直连 prisma 控制进度：不依赖别的批次可能新增的 helpers */
async function setStep(userId: number, step: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tutorialStep: step } });
}

async function stepOf(userId: number): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { tutorialStep: true },
  });
  return user.tutorialStep;
}

/** 当前引导步的 action（以 fixtures 的实际顺序为准，配置漂移时用例先炸） */
function actionOfStep(index: number): string | undefined {
  return getConfig()?.tutorial?.steps[index]?.action;
}

/** 服务端钩子是 fire-and-forget + 独立事务：轮询至多 1s，不用固定 sleep 断言 */
async function waitForStep(userId: number, expected: number, timeoutMs = 1000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let step = await stepOf(userId);
  while (step !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    step = await stepOf(userId);
  }
  return step;
}

/** 负向断言要给在途钩子留出落地时间，否则读到「尚未推进」是假通过 */
async function expectStepStays(userId: number, expected: number, graceMs = 400): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  const step = await stepOf(userId);
  expect(step).toBe(expected);
  return step;
}

describe('tutorial-hooks', () => {
  it('visit_students 只由 GET /api/students 推进，GET /api/overview 不得代为推进', async () => {
    expect(actionOfStep(1)).toBe('visit_students');
    const user = await register();
    await setStep(user.userId, 1);
    const auth = { Authorization: `Bearer ${user.token}` };

    const overview = await request(app).get('/api/overview').set(auth);
    expect(overview.status).toBe(200);
    // overview 内部调用了 listStudents()：钩子若挂在 service 上，这里会被推进到 2
    await expectStepStays(user.userId, 1);

    const students = await request(app).get('/api/students').set(auth);
    expect(students.status).toBe(200);
    expect(await waitForStep(user.userId, 2)).toBe(2);
  });

  it('visit_academy 只由 GET /api/academy/pool 推进，GET /api/overview 不得代为推进', async () => {
    expect(actionOfStep(3)).toBe('visit_academy');
    const user = await register();
    await setStep(user.userId, 3);
    const auth = { Authorization: `Bearer ${user.token}` };

    const overview = await request(app).get('/api/overview').set(auth);
    expect(overview.status).toBe(200);
    // overview 内部调用了 getPool()：钩子若挂在 service 上，这里会被推进到 4
    await expectStepStays(user.userId, 3);

    const pool = await request(app).get('/api/academy/pool').set(auth);
    expect(pool.status).toBe(200);
    expect(await waitForStep(user.userId, 4)).toBe(4);
  });
});
