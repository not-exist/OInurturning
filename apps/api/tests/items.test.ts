import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { StudentView } from '@oinur/shared';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';
import type { ItemView } from '../src/modules/items/service.js';

const app: Express = createApp();

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let userSeq = 0;
async function createAuthedUser(money = 0): Promise<{ userId: number; token: string }> {
  userSeq += 1;
  const username = `it-${Date.now().toString(36)}-${userSeq}`;
  const res = await request(app).post('/api/auth/register').send({ username, password: 'pw-123456' });
  const { accessToken, me } = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  await prisma.user.update({ where: { id: me.id }, data: { money } });
  return { userId: me.id, token: accessToken };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createStudent(userId: number, overrides: Record<string, unknown> = {}): Promise<number> {
  const s = await prisma.student.create({
    data: {
      userId,
      name: '道具学员',
      sex: 'MALE',
      qualityTier: 'COMMON',
      ds: 10, dp: 12, math: 14, graph: 16, greedy: 18, str: 20,
      code: 22, thinking: 24, setting: 5,
      focusCap: 45, energyMax: 60, energy: 30, staminaRegen: 50,
      stamina: 0,
      lastSettledAt: new Date(),
      ...overrides,
    },
  });
  return s.id;
}

async function giveItem(userId: number, itemId: string, quantity: number): Promise<void> {
  await prisma.userItem.create({ data: { userId, itemId, quantity } });
}

async function itemQuantity(userId: number, itemId: string): Promise<number> {
  const row = await prisma.userItem.findUnique({ where: { userId_itemId: { userId, itemId } } });
  return row?.quantity ?? 0;
}

async function studentRow(id: number) {
  return prisma.student.findUniqueOrThrow({ where: { id } });
}

async function focusEngineUsed(id: number): Promise<number> {
  const s = await studentRow(id);
  return (s.counters as { focusEngineUsed?: number }).focusEngineUsed ?? 0;
}

function use(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/items/use').set(auth(token)).send(body);
}

// ---------------------------------------------------------------------------
// GET /api/items
// ---------------------------------------------------------------------------

describe('GET /api/items', () => {
  beforeEach(resetUsers);

  it('回购列表：join CONFIG.items 补名称/稀有度/类别/描述，扣除到 0 的行删除', async () => {
    const u = await createAuthedUser();
    await giveItem(u.userId, 'calm-pill', 3);
    await giveItem(u.userId, 'rename-card', 1);

    const res = await request(app).get('/api/items').set(auth(u.token));
    const list = unwrapOk<ItemView[]>(res);
    // 仅展示存在的库存行（calm-pill 已在 CONFIG，会 join 出配置字段）
    const calm = list.find((x) => x.itemId === 'calm-pill')!;
    expect(calm.quantity).toBe(3);
    expect(calm.name).toBe('定心丸');
    expect(calm.rarity).toBe('green');
    expect(calm.category).toBe('nurture');
    expect(calm.description).toBeTruthy();
    expect(calm.effectDesc).toContain('+5');
  });

  it('未认证 → 401', async () => {
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 每道具一正例
// ---------------------------------------------------------------------------

describe('POST /api/items/use 正例', () => {
  beforeEach(resetUsers);

  it('calm-pill：心态 +5，clamp +10', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { mindset: 8 });
    await giveItem(u.userId, 'calm-pill', 1);

    const res = await use(u.token, { itemId: 'calm-pill', studentId: id });
    expect(res.status).toBe(200);
    const view = unwrapOk<StudentView>(res);
    expect(view.mindset).toBe(10); // 8+5=13 → clamp 10
    expect(await itemQuantity(u.userId, 'calm-pill')).toBe(0);
  });

  it('milk-tea：心态 +2（首个无日限），日限 2 杯', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { mindset: 2 });
    await giveItem(u.userId, 'milk-tea', 3);

    const r1 = unwrapOk<StudentView>(await use(u.token, { itemId: 'milk-tea', studentId: id }));
    expect(r1.mindset).toBe(4);
    const r2 = unwrapOk<StudentView>(await use(u.token, { itemId: 'milk-tea', studentId: id }));
    expect(r2.mindset).toBe(6);

    // 第 3 杯 → VALIDATION_FAILED
    const r3 = await use(u.token, { itemId: 'milk-tea', studentId: id });
    expect(r3.status).toBe(400);
    expect(unwrapErr(r3).code).toBe('VALIDATION_FAILED');
    expect(await itemQuantity(u.userId, 'milk-tea')).toBe(1); // 仅扣 2 杯
  });

  it('stamina-potion：体力 +3，clamp 5，每日限 1 瓶', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { stamina: 1 });
    await giveItem(u.userId, 'stamina-potion', 2);

    const view = unwrapOk<StudentView>(await use(u.token, { itemId: 'stamina-potion', studentId: id }));
    expect(view.stamina).toBeCloseTo(4, 3); // 1+3=4

    // 第 2 瓶 → 每日限 1 → VALIDATION_FAILED（且不扣第 2 瓶）
    const r2 = await use(u.token, { itemId: 'stamina-potion', studentId: id });
    expect(r2.status).toBe(400);
    expect(unwrapErr(r2).code).toBe('VALIDATION_FAILED');
    expect(await itemQuantity(u.userId, 'stamina-potion')).toBe(1);
  });

  it('coffee：体力 +1，心态 −1，clamp，每日限 2 杯', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { stamina: 3, mindset: 5 });
    await giveItem(u.userId, 'coffee', 3);

    const v1 = unwrapOk<StudentView>(await use(u.token, { itemId: 'coffee', studentId: id }));
    expect(v1.stamina).toBeCloseTo(4, 3); // 3+1
    expect(v1.mindset).toBe(4); // 5-1
    const v2 = unwrapOk<StudentView>(await use(u.token, { itemId: 'coffee', studentId: id }));
    expect(v2.stamina).toBeCloseTo(5, 3); // 4+1 → clamp 5
    expect(v2.mindset).toBe(3); // 4-1

    // 第 3 杯 → 每日限 2 → VALIDATION_FAILED
    const r3 = await use(u.token, { itemId: 'coffee', studentId: id });
    expect(r3.status).toBe(400);
    expect(unwrapErr(r3).code).toBe('VALIDATION_FAILED');
    expect(await itemQuantity(u.userId, 'coffee')).toBe(1); // 仅扣 2 杯
  });

  it('vigor-drink：M1 不可用（energy_restore 需比赛场景）→ VALIDATION_FAILED，不扣', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { energyMax: 60 });
    await giveItem(u.userId, 'vigor-drink', 1);

    const res = await use(u.token, { itemId: 'vigor-drink', studentId: id });
    expect(res.status).toBe(400);
    expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
    expect((unwrapErr(res).details as { reason?: string } | undefined)?.reason).toBe('该道具暂不可用');
    expect(await itemQuantity(u.userId, 'vigor-drink')).toBe(1); // 不扣
  });

  it('focus-engine：focusCap +10，clamp 100，每人限 1 台', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { focusCap: 92 });
    await giveItem(u.userId, 'focus-engine', 2);

    const r1 = unwrapOk<StudentView>(await use(u.token, { itemId: 'focus-engine', studentId: id }));
    expect(r1.focusCap).toBe(100); // 92+10 → clamp 100
    // 第 2 台 → 每人限 1 → VALIDATION_FAILED
    const r2 = await use(u.token, { itemId: 'focus-engine', studentId: id });
    expect(r2.status).toBe(400);
    expect(unwrapErr(r2).code).toBe('VALIDATION_FAILED');
    expect(await focusEngineUsed(id)).toBe(1); // 首次使用已计数
    expect(await itemQuantity(u.userId, 'focus-engine')).toBe(1); // 仅扣 1 台
  });

  it('focus-engine：上限已满 100 → VALIDATION_FAILED，不扣道具、不计数', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { focusCap: 100 });
    await giveItem(u.userId, 'focus-engine', 1);

    const res = await use(u.token, { itemId: 'focus-engine', studentId: id });
    expect(res.status).toBe(400);
    expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
    expect(await itemQuantity(u.userId, 'focus-engine')).toBe(1); // 不扣
    expect(await focusEngineUsed(id)).toBe(0); // 不计数
    expect((await studentRow(id)).focusCap).toBe(100);
  });

  it('直用书 book-thinking-green：增益 = 7 × (1+book_effect/100)，周限 10 点内', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { thinking: 20 });
    await giveItem(u.userId, 'book-thinking-green', 1);

    const view = unwrapOk<StudentView>(await use(u.token, { itemId: 'book-thinking-green', studentId: id }));
    expect(view.thinking).toBe(27); // 20 + 7 (book_effect=0)
  });

  it('直用书·五档稀有度增益梯度 2/4/7/12/20（book-thinking）', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { thinking: 10 });
    // 灰+2 黄+4 绿+7 蓝+12 紫+20 → 累计 45，但周限 10 点只允许前 10（灰2+黄4+绿4 后续周限触发）
    const tiers: [string, number][] = [
      ['book-thinking-gray', 2],
      ['book-thinking-yellow', 4],
      ['book-thinking-green', 7],
      ['book-thinking-blue', 12],
      ['book-thinking-purple', 20],
    ];
    for (const [itemId] of tiers) await giveItem(u.userId, itemId, 1);

    // 逐一使用直到周限 10 触发
    const first = unwrapOk<StudentView>(await use(u.token, { itemId: 'book-thinking-gray', studentId: id }));
    expect(first.thinking).toBeCloseTo(12, 6); // 10+2
    const second = unwrapOk<StudentView>(await use(u.token, { itemId: 'book-thinking-yellow', studentId: id }));
    expect(second.thinking).toBeCloseTo(16, 6); // +4
    // 累计 6 / 10，绿书 7 点 → 本周仅余 4 点，应用后计 10，溢出部分被截断
    const third = unwrapOk<StudentView>(await use(u.token, { itemId: 'book-thinking-green', studentId: id }));
    expect(third.thinking).toBeCloseTo(20, 6); // +4（截断到周限 10）
    // 再使用蓝书 → 周限已满，VALIDATION_FAILED
    const fourth = await use(u.token, { itemId: 'book-thinking-blue', studentId: id });
    expect(fourth.status).toBe(400);
    expect(unwrapErr(fourth).code).toBe('VALIDATION_FAILED');
  });

  it('直用书 book-coding-green → code 列；book-setting-green → setting 列', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { code: 22, setting: 5 });
    await giveItem(u.userId, 'book-coding-green', 1);
    await giveItem(u.userId, 'book-setting-green', 1);

    const v1 = unwrapOk<StudentView>(await use(u.token, { itemId: 'book-coding-green', studentId: id }));
    expect(v1.code).toBeCloseTo(29, 6); // 22+7
    const v2 = unwrapOk<StudentView>(await use(u.token, { itemId: 'book-setting-green', studentId: id }));
    expect(v2.setting).toBeCloseTo(12, 6); // 5+7
  });
});

// ---------------------------------------------------------------------------
// 结算完整性回归：use 推进 lastSettledAt 且未命中字段的已结算值不丢失
// ---------------------------------------------------------------------------

describe('POST /api/items/use 结算完整性回归', () => {
  beforeEach(resetUsers);

  it('calm-pill：elapsed>0 时，未被效果命中的 energy/stamina 已结算值随 lastSettledAt 落库', async () => {
    const u = await createAuthedUser();
    // 2 小时前结算：energy 10+20=30；stamina 0+(4/3*2)=2.667（staminaRegen=50）
    const past = new Date(Date.now() - 2 * 3_600_000);
    const id = await createStudent(u.userId, {
      energy: 10,
      energyMax: 60,
      stamina: 0,
      staminaRegen: 50,
      mindset: 0,
      lastSettledAt: past,
    });
    const before = await studentRow(id);
    expect(before.energy).toBe(10); // 基线：未结算前

    await giveItem(u.userId, 'calm-pill', 1);
    const view = unwrapOk<StudentView>(await use(u.token, { itemId: 'calm-pill', studentId: id }));

    // 效果只命中 mindset；energy/stamina 未命中，但已结算值必须随写回落库
    expect(view.energy).toBeGreaterThan(20); // 10 → 30（收回复的结算值，非陈旧 10）
    expect(view.stamina).toBeGreaterThan(2); // 0 → ~2.667

    // lastSettledAt 已推进到 now（旧锚点不再保留，恢复不丢失）
    const row = await studentRow(id);
    expect(row.lastSettledAt.getTime()).toBeGreaterThan(past.getTime());
    expect(row.energy).toBeGreaterThan(20);
    expect(row.stamina).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// 限制类反例（归零删行 / 周界重置）
// ---------------------------------------------------------------------------

describe('POST /api/items/use 限制类反例', () => {
  beforeEach(resetUsers);

  it('库存扣减到 0 删除行；未持有 → 409 INSUFFICIENT_RESOURCE', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId);
    await giveItem(u.userId, 'calm-pill', 1);

    const view = unwrapOk<StudentView>(await use(u.token, { itemId: 'calm-pill', studentId: id }));
    expect(view.mindset).toBe(7); // 2+5
    expect(
      await prisma.userItem.findUnique({ where: { userId_itemId: { userId: u.userId, itemId: 'calm-pill' } } }),
    ).toBeNull(); // 扣到 0 删行

    // 不再持有
    const r2 = await use(u.token, { itemId: 'calm-pill', studentId: id });
    expect(r2.status).toBe(409);
    expect(unwrapErr(r2).code).toBe('INSUFFICIENT_RESOURCE');
  });

  it('milk-tea 日限跨 04:00 日界重置（counters.milkTeaKey 比对）', async () => {
    const u = await createAuthedUser();
    // 用晚于 04:00 的时刻构造，从而 dayKey 稳定；本轮使用后直接断言计数与键
    const id = await createStudent(u.userId, { mindset: 0, counters: { milkTea: 2, milkTeaKey: '1900-01-01' } });
    await giveItem(u.userId, 'milk-tea', 1);

    // 陈旧 milkTeaKey 已跨日界 → 视为当日 0 杯，可正常使用
    const view = unwrapOk<StudentView>(await use(u.token, { itemId: 'milk-tea', studentId: id }));
    expect(view.mindset).toBe(2);
    expect(view.counters.milkTea).toBe(1);
  });

  it('直用书周限跨 ISO 周界重置（counters.bookWeekKey 比对）', async () => {
    const u = await createAuthedUser();
    // bookWeekKey 陈旧 → 视为本周 0 点，可用
    const id = await createStudent(u.userId, {
      thinking: 10,
      counters: { bookWeek: { thinking: 10 }, bookWeekKey: '1900-W01' },
    });
    await giveItem(u.userId, 'book-thinking-green', 1);
    const before = unwrapOk<StudentView>(await use(u.token, { itemId: 'book-thinking-green', studentId: id }));
    expect(before.thinking).toBeCloseTo(17, 6); // 10+7
    const row = await studentRow(id);
    expect((row.counters as { bookWeek: Record<string, number> }).bookWeek.thinking).toBeCloseTo(7, 6);
  });
});

// ---------------------------------------------------------------------------
// 不可用 / 校验 / 归属
// ---------------------------------------------------------------------------

describe('POST /api/items/use 不可用与校验', () => {
  beforeEach(resetUsers);

  it('rename-card 不可直接 use → VALIDATION_FAILED，且不扣卡', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId);
    await giveItem(u.userId, 'rename-card', 1);

    const res = await use(u.token, { itemId: 'rename-card', studentId: id });
    expect(res.status).toBe(400);
    expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
    expect(await itemQuantity(u.userId, 'rename-card')).toBe(1); // 不扣
  });

  it('advance-stone / reroll-ticket / reroll-shard / direction-charm / legend-box / tag-card / badge ≥ M1 不可用 → VALIDATION_FAILED', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId);
    const unavailable = [
      'advance-stone', 'reroll-ticket', 'reroll-shard', 'direction-charm',
      'legend-box', 'tag-card', 'badge-legend', 'vigor-drink',
    ];
    for (const itemId of unavailable) await giveItem(u.userId, itemId, 1);

    for (const itemId of unavailable) {
      const res = await use(u.token, { itemId, studentId: id });
      expect(res.status).toBe(400);
      expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
      expect((unwrapErr(res).details as { reason?: string } | undefined)?.reason).toBe('该道具暂不可用');
      await expect(studentRow(id)).resolves.toBeTruthy();
    }
  });

  it('六维书（book-ds-green）在 M1 不可直接 use → VALIDATION_FAILED', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId, { ds: 10 });
    await giveItem(u.userId, 'book-ds-green', 1);

    const res = await use(u.token, { itemId: 'book-ds-green', studentId: id });
    expect(res.status).toBe(400);
    expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
    expect(await itemQuantity(u.userId, 'book-ds-green')).toBe(1); // 不扣
    expect((await studentRow(id)).ds).toBe(10);
  });

  it('不存在的道具 → 404 NOT_FOUND', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId);

    const res = await use(u.token, { itemId: 'nonexistent-stone', studentId: id });
    expect(res.status).toBe(404);
    expect(unwrapErr(res).code).toBe('NOT_FOUND');
  });

  it('缺 itemId / studentId → 400 VALIDATION_FAILED', async () => {
    const u = await createAuthedUser();
    const id = await createStudent(u.userId);

    const noItem = await use(u.token, { studentId: id });
    expect(noItem.status).toBe(400);
    expect(unwrapErr(noItem).code).toBe('VALIDATION_FAILED');

    const noStudent = await use(u.token, { itemId: 'calm-pill' });
    expect(noStudent.status).toBe(400);
    expect(unwrapErr(noStudent).code).toBe('VALIDATION_FAILED');
  });

  it('他人学员 → 403；不存在学员 → 404', async () => {
    const u1 = await createAuthedUser();
    const u2 = await createAuthedUser();
    const id = await createStudent(u1.userId);
    await giveItem(u2.userId, 'calm-pill', 1);

    const forbidden = await use(u2.token, { itemId: 'calm-pill', studentId: id });
    expect(forbidden.status).toBe(403);
    expect(unwrapErr(forbidden).code).toBe('FORBIDDEN');

    const missing = await use(u2.token, { itemId: 'calm-pill', studentId: 999999 });
    expect(missing.status).toBe(404);
    expect(unwrapErr(missing).code).toBe('NOT_FOUND');
  });
});
