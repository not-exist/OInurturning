import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { QualityTier, StudentView } from '@oinur/shared';
import type { Student } from '@prisma/client';
import { createApp } from '../src/index.js';
import { mulberry32 } from '../src/lib/rng.js';
import { prisma } from '../src/lib/prisma.js';
import { dismissStudent } from '../src/modules/students/service.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

const app: Express = createApp();

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let userSeq = 0;
async function createAuthedUser(money = 0, reputation = 0): Promise<{ userId: number; token: string }> {
  userSeq += 1;
  const username = `st-${Date.now().toString(36)}-${userSeq}`;
  const res = await request(app).post('/api/auth/register').send({ username, password: 'pw-123456' });
  const { accessToken, me } = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  await prisma.user.update({ where: { id: me.id }, data: { money, reputation } });
  return { userId: me.id, token: accessToken };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// 属性取值使 V 可手算：六维均值 floor(90/6)=15，v=floor((22+24+15)/3)=20
async function createStudent(userId: number, overrides: Record<string, unknown> = {}): Promise<Student> {
  return prisma.student.create({
    data: {
      userId,
      name: '学员甲',
      sex: 'MALE',
      qualityTier: 'COMMON',
      ds: 10, dp: 12, math: 14, graph: 16, greedy: 18, str: 20,
      code: 22, thinking: 24, setting: 5,
      focusCap: 45, energyMax: 60, energy: 30, staminaRegen: 50,
      ...overrides,
    },
  });
}

async function giveRenameCard(userId: number, quantity: number): Promise<void> {
  await prisma.userItem.create({ data: { userId, itemId: 'rename-card', quantity } });
}

async function renameCardCount(userId: number): Promise<number> {
  const row = await prisma.userItem.findUnique({
    where: { userId_itemId: { userId, itemId: 'rename-card' } },
  });
  return row?.quantity ?? 0;
}

// 固定两支种子：首值 < 0.35 触发回收 / ≥ 0.35 不回收（mulberry32 确定性）
const RECYCLE_HIT_SEED = (() => { for (let s = 0; ; s++) if (mulberry32(s)() < 0.35) return s; })();
const RECYCLE_MISS_SEED = (() => { for (let s = 0; ; s++) if (mulberry32(s)() >= 0.35) return s; })();

// ---------------------------------------------------------------------------
// GET /api/students
// ---------------------------------------------------------------------------

describe('GET /api/students', () => {
  beforeEach(resetUsers);

  it('只返回 ACTIVE 学员；视图含 V 值/天赋/资源字段', async () => {
    const u = await createAuthedUser();
    await prisma.student.deleteMany({ where: { userId: u.userId } }); // 清开局包 2 学员
    const a = await createStudent(u.userId, { name: '在册甲' });
    const b = await createStudent(u.userId, { name: '在册乙' });
    await createStudent(u.userId, { name: '已开除', status: 'DISMISSED', dismissedAt: new Date() });

    const res = await request(app).get('/api/students').set(auth(u.token));
    const list = unwrapOk<StudentView[]>(res);
    expect(list.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    for (const v of list) {
      expect(v.status).toBe('ACTIVE');
      expect(v.v).toBe(20);
      expect(v.talents).toEqual([]);
      expect(v.counters).toEqual({});
      expect(v.recruitedAt).toBeTruthy();
      expect(v.dismissedAt).toBeNull();
    }
  });

  it('读路径走 settle 纯投影：体力按现实时间恢复，但不落库', async () => {
    const u = await createAuthedUser();
    const s = await createStudent(u.userId, {
      stamina: 0,
      lastSettledAt: new Date(Date.now() - 3 * 3_600_000),
    });

    const res = await request(app).get('/api/students').set(auth(u.token));
    const view = unwrapOk<StudentView[]>(res).find((x) => x.id === s.id)!;
    // regen=50 → (4/3) 点/小时 × 3h ≈ 4（请求往返毫秒级偏差，精度放到 2 位）
    expect(view.stamina).toBeCloseTo(4, 2);

    const row = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.stamina).toBe(0); // 读路径不持久化
  });

  it('未认证 → 401', async () => {
    const res = await request(app).get('/api/students');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/students/:id
// ---------------------------------------------------------------------------

describe('GET /api/students/:id', () => {
  beforeEach(resetUsers);

  it('详情含 counters 稀疏计数器', async () => {
    const u = await createAuthedUser();
    const s = await createStudent(u.userId, { counters: { reroll: 7, vigorUsed: 1 } });
    const res = await request(app).get(`/api/students/${s.id}`).set(auth(u.token));
    const view = unwrapOk<StudentView>(res);
    expect(view.id).toBe(s.id);
    expect(view.counters).toEqual({ reroll: 7, vigorUsed: 1 });
    expect(view.v).toBe(20);
  });

  it('他人学员 → 403 FORBIDDEN；不存在 → 404 NOT_FOUND', async () => {
    const u1 = await createAuthedUser();
    const u2 = await createAuthedUser();
    const s = await createStudent(u1.userId);

    const forbidden = await request(app).get(`/api/students/${s.id}`).set(auth(u2.token));
    expect(forbidden.status).toBe(403);
    expect(unwrapErr(forbidden).code).toBe('FORBIDDEN');

    const missing = await request(app).get('/api/students/999999').set(auth(u1.token));
    expect(missing.status).toBe(404);
    expect(unwrapErr(missing).code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// POST /api/students/:id/rename
// ---------------------------------------------------------------------------

describe('POST /api/students/:id/rename', () => {
  beforeEach(resetUsers);

  it('消耗 rename-card×1 并改名落库；余量归零时删行', async () => {
    const u = await createAuthedUser();
    const s = await createStudent(u.userId);
    await giveRenameCard(u.userId, 1);

    const res = await request(app)
      .post(`/api/students/${s.id}/rename`)
      .set(auth(u.token))
      .send({ name: '新名字' });
    const view = unwrapOk<StudentView>(res);
    expect(view.name).toBe('新名字');

    const row = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.name).toBe('新名字');
    expect(await renameCardCount(u.userId)).toBe(0);
    expect(
      await prisma.userItem.findUnique({ where: { userId_itemId: { userId: u.userId, itemId: 'rename-card' } } }),
    ).toBeNull(); // 扣到 0 删行
  });

  it('2–12 字符边界：2 与 12 通过，1 与 13 → 400 VALIDATION_FAILED', async () => {
    const u = await createAuthedUser();
    const s = await createStudent(u.userId);
    await giveRenameCard(u.userId, 4);

    for (const name of ['阿明', '一二三四五六七八九十甲乙']) {
      const res = await request(app)
        .post(`/api/students/${s.id}/rename`)
        .set(auth(u.token))
        .send({ name });
      expect(res.status).toBe(200);
    }
    for (const name of ['甲', '一二三四五六七八九十甲乙丙']) {
      const res = await request(app)
        .post(`/api/students/${s.id}/rename`)
        .set(auth(u.token))
        .send({ name });
      expect(res.status).toBe(400);
      expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
    }
    expect(await renameCardCount(u.userId)).toBe(2); // 仅成功两次扣卡
  });

  it('无卡 → 409 INSUFFICIENT_RESOURCE，名字不变', async () => {
    const u = await createAuthedUser();
    const s = await createStudent(u.userId);

    const res = await request(app)
      .post(`/api/students/${s.id}/rename`)
      .set(auth(u.token))
      .send({ name: '合法名字' });
    expect(res.status).toBe(409);
    expect(unwrapErr(res).code).toBe('INSUFFICIENT_RESOURCE');
    expect((await prisma.student.findUniqueOrThrow({ where: { id: s.id } })).name).toBe('学员甲');
  });

  it('他人学员 → 403；已开除 → 404', async () => {
    const u1 = await createAuthedUser();
    const u2 = await createAuthedUser();
    await giveRenameCard(u2.userId, 1);
    const s = await createStudent(u1.userId);
    const dismissed = await createStudent(u2.userId, { status: 'DISMISSED', dismissedAt: new Date() });

    const forbidden = await request(app)
      .post(`/api/students/${s.id}/rename`)
      .set(auth(u2.token))
      .send({ name: '合法名字' });
    expect(forbidden.status).toBe(403);

    const gone = await request(app)
      .post(`/api/students/${dismissed.id}/rename`)
      .set(auth(u2.token))
      .send({ name: '合法名字' });
    expect(gone.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/students/:id/dismiss（HTTP 端到端）
// ---------------------------------------------------------------------------

describe('POST /api/students/:id/dismiss', () => {
  beforeEach(resetUsers);

  it('开除：声誉按品质档扣减 + ReputationLog + status=DISMISSED + 列表消失', async () => {
    const u = await createAuthedUser(0, 100);
    const s = await createStudent(u.userId, { qualityTier: 'ELITE' });

    const res = await request(app).post(`/api/students/${s.id}/dismiss`).set(auth(u.token));
    const result = unwrapOk<{
      id: number;
      status: string;
      reputationPenalty: number;
      reputationDelta: number;
      reputation: number;
      recycledRenameCard: boolean;
    }>(res);
    expect(result.status).toBe('DISMISSED');
    expect(result.reputationPenalty).toBe(20);
    expect(result.reputationDelta).toBe(-20);
    expect(result.reputation).toBe(80);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(user.reputation).toBe(80);

    const logs = await prisma.reputationLog.findMany({ where: { userId: u.userId, reason: 'DISMISS' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ delta: -20, reason: 'DISMISS' });

    const row = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.status).toBe('DISMISSED');
    expect(row.dismissedAt).not.toBeNull();

    const list = unwrapOk<StudentView[]>(await request(app).get('/api/students').set(auth(u.token)));
    expect(list.find((x) => x.id === s.id)).toBeUndefined();

    // 回收结果与背包一致（HTTP 路径随机种子，只校验自洽）
    expect(result.recycledRenameCard).toBe((await renameCardCount(u.userId)) === 1);
  });

  it('声誉 floor 0：rep=5 开除 GENIUS（−40）→ 归 0，日志记实际生效 −5', async () => {
    const u = await createAuthedUser(0, 5);
    const s = await createStudent(u.userId, { qualityTier: 'GENIUS' });

    const res = await request(app).post(`/api/students/${s.id}/dismiss`).set(auth(u.token));
    const result = unwrapOk<{ reputationDelta: number; reputation: number }>(res);
    expect(result.reputation).toBe(0);
    expect(result.reputationDelta).toBe(-5);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).reputation).toBe(0);
    const log = await prisma.reputationLog.findFirstOrThrow({ where: { userId: u.userId, reason: 'DISMISS' } });
    expect(log.delta).toBe(-5);
  });

  it('署名题保留、作者置空（student.md §9）', async () => {
    const u = await createAuthedUser(0, 100);
    const s = await createStudent(u.userId);
    const entry = await prisma.problemLibraryEntry.create({
      data: {
        userId: u.userId,
        authorStudentId: s.id,
        name: '样例题',
        dominantDim: 'DS',
        rarity: 'green',
        quality: 50,
      },
    });

    await request(app).post(`/api/students/${s.id}/dismiss`).set(auth(u.token));

    const after = await prisma.problemLibraryEntry.findUnique({ where: { id: entry.id } });
    expect(after).not.toBeNull();
    expect(after!.authorStudentId).toBeNull();
  });

  it('他人学员 → 403；重复开除 → 404；不存在 → 404', async () => {
    const u1 = await createAuthedUser(0, 100);
    const u2 = await createAuthedUser(0, 100);
    const s = await createStudent(u1.userId);

    const forbidden = await request(app).post(`/api/students/${s.id}/dismiss`).set(auth(u2.token));
    expect(forbidden.status).toBe(403);
    expect(unwrapErr(forbidden).code).toBe('FORBIDDEN');

    await request(app).post(`/api/students/${s.id}/dismiss`).set(auth(u1.token));
    const again = await request(app).post(`/api/students/${s.id}/dismiss`).set(auth(u1.token));
    expect(again.status).toBe(404);

    const missing = await request(app).post('/api/students/999999/dismiss').set(auth(u1.token));
    expect(missing.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// dismiss 服务层：35% 改名卡回收（种子固定验证两支）
// ---------------------------------------------------------------------------

describe('dismissStudent：改名卡回收两支（student.md §9，种子随机）', () => {
  beforeEach(resetUsers);

  const PENALTY: Record<QualityTier, number> = { COMMON: 5, GOOD: 10, ELITE: 20, GENIUS: 40 };

  it('品质档罚则表与 student.md §9 一致', async () => {
    for (const [tier, penalty] of Object.entries(PENALTY) as [QualityTier, number][]) {
      const u = await createAuthedUser(0, 1000);
      const s = await createStudent(u.userId, { qualityTier: tier });
      const result = await dismissStudent(u.userId, s.id, mulberry32(RECYCLE_MISS_SEED));
      expect(result.reputationPenalty).toBe(penalty);
      expect(result.reputation).toBe(1000 - penalty);
    }
  });

  it(`命中支（seed=${RECYCLE_HIT_SEED}，首值<0.35）：回收 rename-card×1`, async () => {
    const u = await createAuthedUser(0, 100);
    const s = await createStudent(u.userId);
    const result = await dismissStudent(u.userId, s.id, mulberry32(RECYCLE_HIT_SEED));
    expect(result.recycledRenameCard).toBe(true);
    expect(await renameCardCount(u.userId)).toBe(1);
  });

  it(`未命中支（seed=${RECYCLE_MISS_SEED}，首值≥0.35）：不回收`, async () => {
    const u = await createAuthedUser(0, 100);
    const s = await createStudent(u.userId);
    const result = await dismissStudent(u.userId, s.id, mulberry32(RECYCLE_MISS_SEED));
    expect(result.recycledRenameCard).toBe(false);
    expect(await renameCardCount(u.userId)).toBe(0);
  });

  it('至多回收 1 张：命中时在既有库存上 +1', async () => {
    const u = await createAuthedUser(0, 100);
    await giveRenameCard(u.userId, 3);
    const s = await createStudent(u.userId);
    const result = await dismissStudent(u.userId, s.id, mulberry32(RECYCLE_HIT_SEED));
    expect(result.recycledRenameCard).toBe(true);
    expect(await renameCardCount(u.userId)).toBe(4);
  });

  it('写路径先落结算：开除后锚点推进（lastSettledAt 更新）', async () => {
    const u = await createAuthedUser(0, 100);
    const stale = new Date(Date.now() - 3 * 3_600_000);
    const s = await createStudent(u.userId, { stamina: 0, lastSettledAt: stale });
    await dismissStudent(u.userId, s.id, mulberry32(RECYCLE_MISS_SEED));
    const row = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.lastSettledAt.getTime()).toBeGreaterThan(stale.getTime());
    expect(row.stamina).toBeCloseTo(4, 2); // 结算已持久化
  });
});
