import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 训练补白（training.test.ts 覆盖收益公式/费用/耗材/归属）：
 * 定向缺省灰书、未知书稀有度、专项耗题落库与复用、非法题维度、费用锚点、参数校验。
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
    .send({ username: `traingap-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  await prisma.user.update({ where: { id: session.me.id }, data: { money: 100000 } });
  return { token: session.accessToken, userId: session.me.id };
}

async function makeStudent(userId: number): Promise<{ id: number }> {
  const student = await prisma.student.create({
    data: {
      userId, name: '训练学员', sex: 'MALE', qualityTier: 'COMMON',
      ds: 10, dp: 10, math: 10, graph: 10, greedy: 10, str: 10, code: 10, thinking: 10, setting: 10,
      focusCap: 20, energyMax: 50, energy: 50, staminaRegen: 10,
    },
  });
  return { id: student.id };
}

describe('training gaps', () => {
  it('定向缺省灰书：无书 → 409 且 resource 指向缺省书 id', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    const res = await request(app)
      .post('/api/training/directed')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: student.id, dim: 'DS' });
    expect(res.status).toBe(409);
    expect(unwrapErr(res)).toMatchObject({ code: 'INSUFFICIENT_RESOURCE', details: { resource: 'book-ds-gray', need: 1 } });
  });

  it('定向书稀有度未知 → 400（事务前快检，不扣钱）', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).money;
    const res = await request(app)
      .post('/api/training/directed')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: student.id, dim: 'DS', bookItemId: 'book-ds-rainbow' });
    expect(res.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).money).toBe(before);
  });

  it('专项：耗题落 consumedAt；复用 → 409', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    const problem = await prisma.problemLibraryEntry.create({
      data: { userId: user.userId, authorStudentId: student.id, name: '专项题', dominantDim: 'DS', rarity: 'green', quality: 60 },
    });
    const auth = { Authorization: `Bearer ${user.token}` };
    const first = await request(app).post('/api/training/specialized').set(auth).send({ studentId: student.id, problemId: problem.id });
    expect(first.status).toBe(200);
    expect(unwrapOk<{ dim: string }>(first).dim).toBe('DS');
    expect((await prisma.problemLibraryEntry.findUniqueOrThrow({ where: { id: problem.id } })).consumedAt).not.toBeNull();
    const again = await request(app).post('/api/training/specialized').set(auth).send({ studentId: student.id, problemId: problem.id });
    expect(again.status).toBe(409);
    expect(unwrapErr(again).code).toBe('INSUFFICIENT_RESOURCE');
  });

  it('专项：题目 dominantDim 非法 → 400', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    const problem = await prisma.problemLibraryEntry.create({
      data: { userId: user.userId, authorStudentId: student.id, name: '坏维度题', dominantDim: 'XX', rarity: 'green', quality: 60 },
    });
    const res = await request(app)
      .post('/api/training/specialized')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: student.id, problemId: problem.id });
    expect(res.status).toBe(400);
    expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
  });

  it('费用锚点：directed N=3 → 174，实扣一致', async () => {
    const user = await register();
    await prisma.student.deleteMany({ where: { userId: user.userId } }); // 清开局包 2 学员，还原 N=3
    const students = [await makeStudent(user.userId), await makeStudent(user.userId), await makeStudent(user.userId)];
    await prisma.userItem.create({ data: { userId: user.userId, itemId: 'book-ds-green', quantity: 1 } });
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).money;
    const res = await request(app)
      .post('/api/training/directed')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: students[0]!.id, dim: 'DS', bookItemId: 'book-ds-green' });
    expect(res.status).toBe(200);
    // round(150×(1+0.08×2)) = round(174)（fixtures economy 口径）
    expect(unwrapOk<{ cost: number }>(res).cost).toBe(174);
    expect(before - (await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).money).toBe(174);
  });

  it('参数校验：非法 dim/缺 problemId → 400', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const badDim = await request(app).post('/api/training/directed').set(auth).send({ studentId: student.id, dim: 'XX' });
    expect(badDim.status).toBe(400);
    const missing = await request(app).post('/api/training/specialized').set(auth).send({ studentId: student.id });
    expect(missing.status).toBe(400);
  });
});
