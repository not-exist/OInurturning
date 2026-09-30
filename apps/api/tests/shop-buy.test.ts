import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { getConfig, importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetIdempotencyStore } from '../src/lib/idempotency.js';
import { resetUsers, unwrapOk, unlockTutorial } from './helpers.js';

/**
 * 商店下单的幂等（TECH-DESIGN §12 T8 要求"商城下单"支持 Idempotency-Key）：
 * - 带同一把 key 的重复下单：重放原响应，**不再扣钱**（否则超时重试/重复点击会重复扣款）
 * - key 相同但请求体不同（itemId/数量）应视为另一个操作，**不能**被重放
 * - 不带 key 时行为不变；key 非法（>128）应 400
 */
const app: Express = createApp();
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/config');
let seq = 0;

beforeAll(async () => {
  await importConfigs({ configDir: FIXTURES });
});
beforeEach(async () => {
  await resetUsers();
  resetIdempotencyStore();
});
afterAll(async () => {
  await importConfigs({ configDir: FIXTURES });
});

async function register(): Promise<{ token: string; userId: number }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `shopbuy-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  await unlockTutorial(session.me.id);
  return { token: session.accessToken, userId: session.me.id };
}

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function fund(userId: number, money: number): Promise<number> {
  const updated = await prisma.user.update({ where: { id: userId }, data: { money } });
  return updated.money;
}

async function moneyOf(userId: number): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { money: true } });
  return user.money;
}

type BuyResult = { moneyAfter: number; ownedQuantity: number; totalCost: number };

describe('shop buy idempotency', () => {
  it('同一把 key 重复下单：重放原响应且不再扣钱', async () => {
    const { token, userId } = await register();
    await fund(userId, 10000);
    const price = getConfig()!.items['milk-tea']!.price!;
    const key = 'idem-same-key-1';

    const first = await request(app)
      .post('/api/shop/buy')
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send({ itemId: 'milk-tea', quantity: 1 });
    expect(first.status).toBe(200);
    const firstData = unwrapOk<BuyResult>(first);
    expect(firstData.totalCost).toBe(price);
    expect(await moneyOf(userId)).toBe(10000 - price);

    const replay = await request(app)
      .post('/api/shop/buy')
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send({ itemId: 'milk-tea', quantity: 1 });
    expect(replay.status).toBe(200);
    const replayData = unwrapOk<BuyResult>(replay);
    expect(replayData).toEqual(firstData); // 原响应重放
    expect(await moneyOf(userId), '重放不得再次扣钱').toBe(10000 - price);
  });

  it('同一把 key 并发下单：合并为一次执行，恰好扣一次钱', async () => {
    const { token, userId } = await register();
    await fund(userId, 10000);
    const price = getConfig()!.items['milk-tea']!.price!;
    const key = 'idem-concurrent-1';
    // 开局包自带 milk-tea×2，以购买前的持有量为基线断言恰好 +1
    const before = await prisma.userItem.findUnique({
      where: { userId_itemId: { userId, itemId: 'milk-tea' } },
    });

    const [a, b] = await Promise.all([
      request(app).post('/api/shop/buy').set(auth(token)).set('Idempotency-Key', key).send({ itemId: 'milk-tea', quantity: 1 }),
      request(app).post('/api/shop/buy').set(auth(token)).set('Idempotency-Key', key).send({ itemId: 'milk-tea', quantity: 1 }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const aData = unwrapOk<BuyResult>(a);
    expect(unwrapOk<BuyResult>(b)).toEqual(aData); // 两个响应同源（共享同一次执行）
    expect(await moneyOf(userId), '并发不得重复扣钱').toBe(10000 - price);
    expect(aData.ownedQuantity, '库存只加一次').toBe((before?.quantity ?? 0) + 1);
    expect(await prisma.shopPurchaseLog.count({ where: { userId } }), '恰好一条购买流水').toBe(1);
  });

  it('同一把 key 但数量不同：指纹不同，应真实下单而非重放', async () => {
    const { token, userId } = await register();
    await fund(userId, 10000);
    const price = getConfig()!.items['milk-tea']!.price!;
    const key = 'idem-same-key-2';

    const one = await request(app)
      .post('/api/shop/buy')
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send({ itemId: 'milk-tea', quantity: 1 });
    expect(one.status).toBe(200);
    expect(await moneyOf(userId)).toBe(10000 - price);

    const two = await request(app)
      .post('/api/shop/buy')
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send({ itemId: 'milk-tea', quantity: 2 });
    expect(two.status).toBe(200);
    expect(unwrapOk<BuyResult>(two).totalCost).toBe(price * 2);
    expect(await moneyOf(userId)).toBe(10000 - price - price * 2);
  });

  it('不带幂等键时行为不变（每次都真实扣款）', async () => {
    const { token, userId } = await register();
    await fund(userId, 10000);
    const price = getConfig()!.items['milk-tea']!.price!;

    for (let i = 1; i <= 2; i += 1) {
      const res = await request(app).post('/api/shop/buy').set(auth(token)).send({ itemId: 'milk-tea', quantity: 1 });
      expect(res.status).toBe(200);
    }
    expect(await moneyOf(userId)).toBe(10000 - price * 2);
  });

  it('幂等键超长 → 400 VALIDATION_FAILED', async () => {
    const { token, userId } = await register();
    await fund(userId, 10000);
    const res = await request(app)
      .post('/api/shop/buy')
      .set(auth(token))
      .set('Idempotency-Key', 'x'.repeat(129))
      .send({ itemId: 'milk-tea', quantity: 1 });
    expect(res.status).toBe(400);
  });
});
