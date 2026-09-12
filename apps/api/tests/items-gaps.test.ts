import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 背包补白（items.test.ts 已穷举 M1 可用道具效果/限额/跨界重置）：
 * 并发扣减原子性、账号型道具缺货、已开除学员、空背包与价格展示、失败不扣。
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
    .send({ username: `itemgap-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { token: session.accessToken, userId: session.me.id };
}

async function makeStudent(userId: number): Promise<{ id: number }> {
  const student = await prisma.student.create({
    data: {
      userId, name: '道具学员', sex: 'MALE', qualityTier: 'COMMON',
      ds: 10, dp: 10, math: 10, graph: 10, greedy: 10, str: 10, code: 10, thinking: 10, setting: 10,
      focusCap: 20, energyMax: 50, energy: 50, staminaRegen: 10,
    },
  });
  return { id: student.id };
}

describe('items gaps', () => {
  it('并发使用最后一件 → 恰其一成功，库存归零删行', async () => {
    const user = await register();
    await prisma.userItem.deleteMany({ where: { userId: user.userId } }); // 清开局包库存（自带奶茶×2）
    const student = await makeStudent(user.userId);
    await prisma.userItem.create({ data: { userId: user.userId, itemId: 'milk-tea', quantity: 1 } });
    const auth = { Authorization: `Bearer ${user.token}` };
    const [a, b] = await Promise.all([
      request(app).post('/api/items/use').set(auth).send({ itemId: 'milk-tea', studentId: student.id }),
      request(app).post('/api/items/use').set(auth).send({ itemId: 'milk-tea', studentId: student.id }),
    ]);
    // 失败方确定性走缺货分支：胜方提交删除库存行后，败方持学员锁读到行缺失 → INSUFFICIENT_RESOURCE
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(unwrapErr(loser).code).toBe('INSUFFICIENT_RESOURCE');
    expect(await prisma.userItem.findUnique({ where: { userId_itemId: { userId: user.userId, itemId: 'milk-tea' } } })).toBeNull();
  });

  it('intel-slip 无持有 → INSUFFICIENT_RESOURCE（账号型通道优先于学员校验）', async () => {
    const user = await register();
    const res = await request(app)
      .post('/api/items/use')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ itemId: 'intel-slip' });
    expect(res.status).toBe(409);
    expect(unwrapErr(res)).toMatchObject({ code: 'INSUFFICIENT_RESOURCE' });
  });

  it('已开除学员 → NOT_FOUND', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    await prisma.student.update({ where: { id: student.id }, data: { status: 'DISMISSED' } });
    await prisma.userItem.create({ data: { userId: user.userId, itemId: 'calm-pill', quantity: 1 } });
    const res = await request(app)
      .post('/api/items/use')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ itemId: 'calm-pill', studentId: student.id });
    expect(res.status).toBe(404);
  });

  it('空背包 → []；不可购买道具 price 为 null', async () => {
    const user = await register();
    await prisma.userItem.deleteMany({ where: { userId: user.userId } }); // 清开局包库存，还原空背包前置
    const empty = unwrapOk<unknown[]>(
      await request(app).get('/api/items').set('Authorization', `Bearer ${user.token}`),
    );
    expect(empty).toEqual([]);
    await prisma.userItem.create({ data: { userId: user.userId, itemId: 'advance-stone', quantity: 3 } });
    const list = unwrapOk<Array<{ itemId: string; quantity: number; price: number | null; name: string }>>(
      await request(app).get('/api/items').set('Authorization', `Bearer ${user.token}`),
    );
    expect(list).toEqual([expect.objectContaining({ itemId: 'advance-stone', quantity: 3, price: null })]);
  });

  it('效果失败不扣道具：超日限后库存不变', async () => {
    const user = await register();
    await prisma.userItem.deleteMany({ where: { userId: user.userId } }); // 清开局包库存（自带奶茶×2）
    const student = await makeStudent(user.userId);
    await prisma.userItem.create({ data: { userId: user.userId, itemId: 'milk-tea', quantity: 3 } });
    const auth = { Authorization: `Bearer ${user.token}` };
    for (let i = 0; i < 2; i += 1) {
      const ok = await request(app).post('/api/items/use').set(auth).send({ itemId: 'milk-tea', studentId: student.id });
      expect(ok.status).toBe(200);
    }
    const limited = await request(app).post('/api/items/use').set(auth).send({ itemId: 'milk-tea', studentId: student.id });
    expect(limited.status).toBe(400);
    const left = await prisma.userItem.findUniqueOrThrow({ where: { userId_itemId: { userId: user.userId, itemId: 'milk-tea' } } });
    expect(left.quantity).toBe(1);
  });
});
