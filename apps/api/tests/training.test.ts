import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DimensionKey } from '@oinur/shared';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { mulberry32 } from '../src/lib/rng.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';
import {
  computeCost,
  computeDelta,
  computeSecondaryGains,
  DIM_META,
  TRAINING_BASE,
} from '../src/modules/training/gains.js';
import { basicTrain } from '../src/modules/training/service.js';
import type { TrainingResult as HttpResult } from '../src/modules/training/service.js';

const app: Express = createApp();

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let userSeq = 0;
async function createAuthedUser(money = 0): Promise<{ userId: number; token: string }> {
  userSeq += 1;
  const username = `tr-${Date.now().toString(36)}-${userSeq}`;
  const res = await request(app).post('/api/auth/register').send({ username, password: 'pw-123456' });
  const { accessToken, me } = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  await prisma.user.update({ where: { id: me.id }, data: { money } });
  return { userId: me.id, token: accessToken };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** 六维全部 = 10（使基础训练任意维 cur 相同，锚点可手算）；stamina 默认 5 */
async function createStudent(userId: number, overrides: Record<string, unknown> = {}): Promise<number> {
  const s = await prisma.student.create({
    data: {
      userId,
      name: '训练学员',
      sex: 'MALE',
      qualityTier: 'COMMON',
      ds: 10, dp: 10, math: 10, graph: 10, greedy: 10, str: 10,
      code: 10, thinking: 10, setting: 10,
      focusCap: 45, energyMax: 60, energy: 30, staminaRegen: 50,
      lastSettledAt: new Date(),
      ...overrides,
    },
  });
  return s.id;
}

async function userMoney(userId: number): Promise<number> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).money;
}

async function studentRow(id: number) {
  return prisma.student.findUniqueOrThrow({ where: { id } });
}

async function giveItem(userId: number, itemId: string, quantity: number): Promise<void> {
  await prisma.userItem.create({ data: { userId, itemId, quantity } });
}

async function itemQuantity(userId: number, itemId: string): Promise<number> {
  const row = await prisma.userItem.findUnique({ where: { userId_itemId: { userId, itemId } } });
  return row?.quantity ?? 0;
}

async function giveProblem(userId: number, overrides: Record<string, unknown> = {}): Promise<number> {
  const p = await prisma.problemLibraryEntry.create({
    data: {
      userId,
      name: '预制题',
      dominantDim: 'DS',
      rarity: 'green',
      quality: 60,
      ...overrides,
    },
  });
  return p.id;
}

const DIM_KEYS: DimensionKey[] = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'];

// ---------------------------------------------------------------------------
// gains 纯函数（确定性种子可复现 / 锚点）
// ---------------------------------------------------------------------------

describe('gains 纯函数', () => {
  it('computeDelta：cur=10 base=1.6 全乘 1 → ≈1.296（student.md §4.3）', () => {
    const delta = computeDelta({ base: TRAINING_BASE.basic, bookMult: 1, qualityMult: 1, meta: {}, dimMetaKey: 'training_ds', cur: 10 });
    expect(delta).toBeCloseTo(1.296, 6); // 1.6 × 0.9^2
  });

  it('computeDelta：cur≥100 → 0', () => {
    expect(computeDelta({ base: 1.6, bookMult: 1, qualityMult: 1, meta: {}, dimMetaKey: 'training_ds', cur: 100 })).toBe(0);
    expect(computeDelta({ base: 1.6, bookMult: 1, qualityMult: 1, meta: {}, dimMetaKey: 'training_ds', cur: 105 })).toBe(0);
  });

  it('computeDelta：meta 乘算展开（training_all +15 与 training_ds +15 乘算 → ×1.3225）', () => {
    const delta = computeDelta({
      base: 1.6, bookMult: 1, qualityMult: 1,
      meta: { training_all: 15, training_ds: 15 },
      dimMetaKey: 'training_ds', cur: 0,
    });
    expect(delta).toBeCloseTo(1.6 * 1.15 * 1.15, 6);
  });

  it('computeCost：N=1/5 锚点（basic）', () => {
    expect(computeCost({ moneyBase: 60, coeff: 0.08, ownedStudents: 1 })).toBe(60);
    expect(computeCost({ moneyBase: 60, coeff: 0.08, ownedStudents: 5 })).toBe(79); // round(60×1.32)
  });

  it('computeSecondaryGains：确定性 rng 可复现概率表与阻尼', () => {
    // rng 消费顺序：code → thinking → setting → mindset → focus_cap → stamina_regen
    // 命中 code（0.01）与 setting（0.01），其余未命中
    const seq = [0.01, 0.5, 0.01, 0.5, 0.5, 0.5];
    let i = 0;
    const rng = () => seq[i++];
    const student = { code: 10, thinking: 10, setting: 10, mindset: 2, focusCap: 45, staminaRegen: 50 } as never;
    const { patch, rareGains } = computeSecondaryGains({ type: 'basic', student, meta: {}, rng });
    // code：20% × 0.01 命中，阻尼 (1−0.1)^2 = 0.81 → +0.81
    expect(patch.code).toBeCloseTo(10.81, 6);
    // setting：2% × 0.01 命中 → +1（无阻尼）
    expect(patch.setting).toBe(11);
    expect(rareGains.map((g) => g.stat)).toEqual(['code', 'setting']);
    expect(rareGains.find((g) => g.stat === 'code')!.amount).toBeCloseTo(0.81, 6);
  });

  it('computeSecondaryGains：四项极低概率不受加成、code 概率受 training_code 修饰', () => {
    const seq = [0.01, 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const rng = () => seq[i++];
    // training_code=100 → code 概率 0.2×2=0.4，0.01 命中
    const { patch } = computeSecondaryGains({ type: 'basic', student: { code: 10, thinking: 10, setting: 1, mindset: 2, focusCap: 45, staminaRegen: 50 } as never, meta: { training_code: 100 }, rng });
    expect(patch.code).toBeCloseTo(10.81, 6);
  });
});

// ---------------------------------------------------------------------------
// POST /api/training/basic
// ---------------------------------------------------------------------------

describe('POST /api/training/basic', () => {
  beforeEach(resetUsers);

  it('随机一维，delta 锚点（cur=10 → ≈1.296 落库浮点），扣钱、体力 −1', async () => {
    const u = await createAuthedUser(1000);
    const id = await createStudent(u.userId);

    const res = await request(app).post('/api/training/basic').set(auth(u.token)).send({ studentId: id });
    expect(res.status).toBe(200);
    const r = unwrapOk<HttpResult>(res);
    expect(DIM_KEYS).toContain(r.dim);
    expect(r.delta).toBeCloseTo(1.296, 6);
    expect(r.cost).toBe(70); // N=3（开局包 2 + 新建 1）：round(60×1.16)=70
    expect(r.staminaAfter).toBe(4); // 5 − 1

    const row = await studentRow(id);
    // 命中维：cur=10 +1.296 = 11.296
    expect(row[DIM_META[r.dim].column]).toBeCloseTo(11.296, 6);
    expect(await userMoney(u.userId)).toBe(1000 - 70);
  });

  it('体力 0 → 409 STATE_CONFLICT，不扣钱', async () => {
    const u = await createAuthedUser(1000);
    const id = await createStudent(u.userId, { stamina: 0 });

    const res = await request(app).post('/api/training/basic').set(auth(u.token)).send({ studentId: id });
    expect(res.status).toBe(409);
    expect(unwrapErr(res).code).toBe('STATE_CONFLICT');
    expect(await userMoney(u.userId)).toBe(1000); // 未扣
  });

  it('钱不足 → 409 INSUFFICIENT_RESOURCE', async () => {
    const u = await createAuthedUser(10);
    const id = await createStudent(u.userId);

    const res = await request(app).post('/api/training/basic').set(auth(u.token)).send({ studentId: id });
    expect(res.status).toBe(409);
    expect(unwrapErr(res).code).toBe('INSUFFICIENT_RESOURCE');
  });

  it('费用 N=7 时 basic=89', async () => {
    const u = await createAuthedUser(10000);
    for (let i = 0; i < 4; i++) await createStudent(u.userId); // 4 + 目标 1 + 开局包 2 = 7 在册
    const id = await createStudent(u.userId);

    const res = await request(app).post('/api/training/basic').set(auth(u.token)).send({ studentId: id });
    const r = unwrapOk<HttpResult>(res);
    expect(r.cost).toBe(89); // round(60×(1+0.08×6))=89
  });

  it('基础训练随机维种子可复现（service 层注入 mulberry32 同种子同结果）', async () => {
    const u = await createAuthedUser(10000);
    const a = await createStudent(u.userId);
    const b = await createStudent(u.userId);
    const s = 1234;
    const r1 = await basicTrain(u.userId, a, mulberry32(s), new Date());
    const r2 = await basicTrain(u.userId, b, mulberry32(s), new Date());
    expect(r1.dim).toBe(r2.dim);
    expect(r1.delta).toBeCloseTo(r2.delta, 12);
    expect(r1.rareGains).toEqual(r2.rareGains);
  });
});

// ---------------------------------------------------------------------------
// POST /api/training/directed
// ---------------------------------------------------------------------------

describe('POST /api/training/directed', () => {
  beforeEach(resetUsers);

  it('耗对应六维书：dim=DS + book-ds-green（Mult 1.5）→ Δ=2.0×1.5×0.81=2.43', async () => {
    const u = await createAuthedUser(5000);
    const id = await createStudent(u.userId, { ds: 10 });
    await giveItem(u.userId, 'book-ds-green', 1);

    const res = await request(app).post('/api/training/directed').set(auth(u.token)).send({ studentId: id, dim: 'DS', bookItemId: 'book-ds-green' });
    expect(res.status).toBe(200);
    const r = unwrapOk<HttpResult>(res);
    expect(r.dim).toBe('DS');
    expect(r.delta).toBeCloseTo(2.43, 6);
    expect(r.cost).toBe(174); // N=3：round(150×1.16)=174
    expect((await studentRow(id)).ds).toBeCloseTo(12.43, 6);
    expect(await itemQuantity(u.userId, 'book-ds-green')).toBe(0); // 扣到 0 删行
    expect(await userMoney(u.userId)).toBe(5000 - 174);
  });

  it('缺书 → 409 INSUFFICIENT_RESOURCE，不扣钱不掉体力', async () => {
    const u = await createAuthedUser(5000);
    const id = await createStudent(u.userId, { ds: 10 });
    const before = await studentRow(id);

    const res = await request(app).post('/api/training/directed').set(auth(u.token)).send({ studentId: id, dim: 'DS' });
    expect(res.status).toBe(409);
    expect(unwrapErr(res).code).toBe('INSUFFICIENT_RESOURCE');
    expect((await studentRow(id)).ds).toBe(before.ds);
    expect(await userMoney(u.userId)).toBe(5000);
  });

  it('书科目与目标维不符 → 400 VALIDATION_FAILED，不扣书不扣钱', async () => {
    const u = await createAuthedUser(5000);
    const id = await createStudent(u.userId, { dp: 10 });
    await giveItem(u.userId, 'book-ds-green', 1);

    const res = await request(app).post('/api/training/directed').set(auth(u.token)).send({ studentId: id, dim: 'DP', bookItemId: 'book-ds-green' });
    expect(res.status).toBe(400);
    expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
    expect(await itemQuantity(u.userId, 'book-ds-green')).toBe(1); // 不扣
    expect(await userMoney(u.userId)).toBe(5000);
  });

  it('cur=100 → Δ=0，体力与钱仍消耗', async () => {
    const u = await createAuthedUser(5000);
    const id = await createStudent(u.userId, { ds: 100 });
    await giveItem(u.userId, 'book-ds-green', 1);

    const res = await request(app).post('/api/training/directed').set(auth(u.token)).send({ studentId: id, dim: 'DS', bookItemId: 'book-ds-green' });
    const r = unwrapOk<HttpResult>(res);
    expect(r.delta).toBe(0);
    expect((await studentRow(id)).ds).toBe(100);
    expect(r.cost).toBe(174); // N=3
    expect(await itemQuantity(u.userId, 'book-ds-green')).toBe(0); // 书仍耗
  });

  it('缺 dim → 400 VALIDATION_FAILED', async () => {
    const u = await createAuthedUser(5000);
    const id = await createStudent(u.userId);
    const res = await request(app).post('/api/training/directed').set(auth(u.token)).send({ studentId: id });
    expect(res.status).toBe(400);
    expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
  });
});

// ---------------------------------------------------------------------------
// POST /api/training/specialized
// ---------------------------------------------------------------------------

describe('POST /api/training/specialized', () => {
  beforeEach(resetUsers);

  it('耗预制题（dominantDim 应为目标维）：green 题 QualityMult 1.2 → Δ=3.2×1.2×0.81=3.1104', async () => {
    const u = await createAuthedUser(5000);
    const id = await createStudent(u.userId, { ds: 10 });
    const pid = await giveProblem(u.userId, { dominantDim: 'DS', rarity: 'green' });

    const res = await request(app).post('/api/training/specialized').set(auth(u.token)).send({ studentId: id, problemId: pid });
    expect(res.status).toBe(200);
    const r = unwrapOk<HttpResult>(res);
    expect(r.dim).toBe('DS');
    expect(r.delta).toBeCloseTo(3.1104, 6);
    expect(r.cost).toBe(116); // N=3：round(100×1.16)=116
    expect((await studentRow(id)).ds).toBeCloseTo(13.1104, 6);
    const p = await prisma.problemLibraryEntry.findUniqueOrThrow({ where: { id: pid } });
    expect(p.consumedAt).not.toBeNull();
    expect(await userMoney(u.userId)).toBe(5000 - 116);
  });

  it('题目已用 → 409 INSUFFICIENT_RESOURCE', async () => {
    const u = await createAuthedUser(5000);
    const id = await createStudent(u.userId, { ds: 10 });
    const pid = await giveProblem(u.userId, { consumedAt: new Date() });

    const res = await request(app).post('/api/training/specialized').set(auth(u.token)).send({ studentId: id, problemId: pid });
    expect(res.status).toBe(409);
    expect(unwrapErr(res).code).toBe('INSUFFICIENT_RESOURCE');
    expect(await userMoney(u.userId)).toBe(5000);
  });

  it('他人题目 → 403 FORBIDDEN；不存在 → 404', async () => {
    const u1 = await createAuthedUser(5000);
    const u2 = await createAuthedUser(5000);
    const id = await createStudent(u1.userId, { ds: 10 });
    const pid = await giveProblem(u1.userId);

    const forbidden = await request(app).post('/api/training/specialized').set(auth(u2.token)).send({ studentId: id, problemId: pid });
    expect(forbidden.status).toBe(403);
    expect(unwrapErr(forbidden).code).toBe('FORBIDDEN');

    const missing = await request(app).post('/api/training/specialized').set(auth(u1.token)).send({ studentId: id, problemId: 999999 });
    expect(missing.status).toBe(404);
    expect(unwrapErr(missing).code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// 归属 / 校验
// ---------------------------------------------------------------------------

describe('POST /api/training 归属与校验', () => {
  beforeEach(resetUsers);

  it('他人学员 → 403；DISMISSED → 404', async () => {
    const u1 = await createAuthedUser(5000);
    const u2 = await createAuthedUser(5000);
    const id = await createStudent(u1.userId);

    const forbidden = await request(app).post('/api/training/basic').set(auth(u2.token)).send({ studentId: id });
    expect(forbidden.status).toBe(403);
    expect(unwrapErr(forbidden).code).toBe('FORBIDDEN');

    await prisma.student.update({ where: { id }, data: { status: 'DISMISSED', dismissedAt: new Date() } });
    const dismissed = await request(app).post('/api/training/basic').set(auth(u1.token)).send({ studentId: id });
    expect(dismissed.status).toBe(404);
    expect(unwrapErr(dismissed).code).toBe('NOT_FOUND');
  });

  it('未认证 → 401', async () => {
    const res = await request(app).post('/api/training/basic').send({ studentId: 1 });
    expect(res.status).toBe(401);
  });
});
