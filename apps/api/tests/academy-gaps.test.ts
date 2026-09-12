import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 招募补白（academy.test.ts 覆盖生成/权重/懒刷新/招募主路径）：
 * 无池刷新/招募、刷新价格封顶、并发首建池、招空池。
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

async function register(money = 0): Promise<{ token: string; userId: number }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `acadgap-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  if (money > 0) await prisma.user.update({ where: { id: session.me.id }, data: { money } });
  return { token: session.accessToken, userId: session.me.id };
}

interface PoolView {
  candidates: Array<{ tempId: string; price: number }>;
  generatedAt: string;
  refreshesToday: number;
  refreshPrice: number;
}

describe('academy gaps', () => {
  it('无池时刷新/招募 → NOT_FOUND recruitPool', async () => {
    const user = await register(100000);
    const auth = { Authorization: `Bearer ${user.token}` };
    await prisma.recruitPool.delete({ where: { userId: user.userId } }); // 注册即预建池：删池还原“无池”前置
    const refresh = await request(app).post('/api/academy/refresh').set(auth);
    expect(refresh.status).toBe(404);
    expect(unwrapErr(refresh)).toMatchObject({ code: 'NOT_FOUND' });
    const recruit = await request(app).post('/api/academy/recruit').set(auth).send({ tempId: 'whatever' });
    expect(recruit.status).toBe(404);
    expect(unwrapErr(recruit)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('刷新价格封顶 800（HTTP 实扣）', async () => {
    const user = await register(100000);
    const auth = { Authorization: `Bearer ${user.token}` };
    const pool = unwrapOk<PoolView>(await request(app).get('/api/academy/pool').set(auth));
    expect(pool.candidates).toHaveLength(5);
    await prisma.recruitPool.update({ where: { userId: user.userId }, data: { refreshesToday: 10 } });
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).money;
    const res = await request(app).post('/api/academy/refresh').set(auth);
    expect(res.status).toBe(200);
    // round(100×1.5^10)=5767 → 封顶 800（fixtures recruitment 口径）
    expect(before - (await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).money).toBe(800);
    expect(unwrapOk<PoolView>(res).refreshesToday).toBe(11);
  });

  it('并发首建池 → 双双 200 且为同一池', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };
    await prisma.recruitPool.delete({ where: { userId: user.userId } }); // 删预建池，还原 P2002 竞态前置
    const [a, b] = await Promise.all([
      request(app).get('/api/academy/pool').set(auth),
      request(app).get('/api/academy/pool').set(auth),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const poolA = unwrapOk<PoolView>(a);
    const poolB = unwrapOk<PoolView>(b);
    expect(poolA.generatedAt).toBe(poolB.generatedAt);
    expect(poolA.candidates.map((c) => c.tempId).sort()).toEqual(poolB.candidates.map((c) => c.tempId).sort());
  });

  it('招满 5 人 → 池空，再招同一 tempId → 404', async () => {
    const user = await register(10_000_000);
    const auth = { Authorization: `Bearer ${user.token}` };
    const pool = unwrapOk<PoolView>(await request(app).get('/api/academy/pool').set(auth));
    for (const candidate of pool.candidates) {
      const res = await request(app).post('/api/academy/recruit').set(auth).send({ tempId: candidate.tempId });
      expect(res.status).toBe(200);
    }
    const drained = unwrapOk<PoolView>(await request(app).get('/api/academy/pool').set(auth));
    expect(drained.candidates).toEqual([]);
    const again = await request(app).post('/api/academy/recruit').set(auth).send({ tempId: pool.candidates[0]!.tempId });
    expect(again.status).toBe(404);
    // 开局包 2 + 招满 5 = 7 在册
    expect(await prisma.student.count({ where: { userId: user.userId, status: 'ACTIVE' } })).toBe(7);
  });
});
