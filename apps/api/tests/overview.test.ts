import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unlockTutorial, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 总览聚合 + 开局 checklist + 徽章领取幂等。
 * checklist 语义（无新表，派生判定）：训练/讲课任意记录、历练 RESOLVED、
 * 剧情 clearCount>0、在册≥3 人。
 */
const app: Express = createApp();
const DOCS = path.resolve(import.meta.dirname, '../../../docs/data');
let seq = 0;

// 本文件断言 docs 口径（33 关/讲课档位/历练事件/招募价）：VITEST 默认只装 fixtures，
// 其 economy 无 lecture.audience_tiers（讲课 500）且仅 1 关，故显式导入 docs。
beforeAll(async () => {
  await importConfigs({ configDir: DOCS });
});

async function register(): Promise<{ token: string; userId: number }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `ov-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  await unlockTutorial(session.me.id);
  return { token: session.accessToken, userId: session.me.id };
}

async function onboardingStudents(userId: number): Promise<{ id: number; qualityTier: string }[]> {
  return prisma.student.findMany({
    where: { userId },
    orderBy: { id: 'asc' },
    select: { id: true, qualityTier: true },
  });
}

/** 历练万能钥匙篮 + 回体药水（upsert 累加，开局包奶茶不冲突） */
async function fundAdventurer(userId: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { money: 200000 } });
  for (const [itemId, quantity] of Object.entries({
    'direction-charm': 2,
    firewall: 2,
    'milk-tea': 3,
    'spare-cable': 2,
    'stamina-potion': 2,
  })) {
    await prisma.userItem.upsert({
      where: { userId_itemId: { userId, itemId } },
      create: { userId, itemId, quantity },
      update: { quantity: { increment: quantity } },
    });
  }
}

interface Choice {
  index: number;
  available: boolean;
}

interface DrawnView {
  id: number;
  event: { choices: Choice[] | null };
}

/** 逐个试可用分支直到结算（高额资金+钥匙篮保证必有可解分支）；历练固定 3 人队伍 */
async function resolveAdventure(token: string, roster: number[]): Promise<void> {
  const auth = { Authorization: `Bearer ${token}` };
  const drawn = unwrapOk<DrawnView>(
    await request(app).post('/api/adventures/draw').set(auth).send({ roster, tier: 1 }),
  );
  let completed = false;
  for (const choice of drawn.event.choices ?? []) {
    if (!choice.available) continue;
    const resolved = await request(app)
      .post(`/api/adventures/${drawn.id}/choice`)
      .set(auth)
      .send({ optionIndex: choice.index });
    if (resolved.status === 200 && unwrapOk<{ completed: boolean }>(resolved).completed) {
      completed = true;
      break;
    }
  }
  expect(completed).toBe(true);
}

async function stageCleared(token: string, stageKey: string): Promise<boolean> {
  const progress = unwrapOk<{ stageKey: string; clearCount: number }[]>(
    await request(app)
      .get('/api/story/progress')
      .set({ Authorization: `Bearer ${token}` }),
  );
  return (progress.find((p) => p.stageKey === stageKey)?.clearCount ?? 0) > 0;
}

interface OverviewBody {
  me: { money: number; reputation: number; onboardedAt: string | null };
  students: { total: number; items: { id: number; v: number }[] };
  story: {
    clearedStages: number;
    totalStages: number;
    nextStage: { stageKey: string; name: string; chapter: string } | null;
  };
  pool: { count: number; refreshPrice: number; freeRefreshAt: string };
  recent: { training: unknown[]; lectures: unknown[]; adventures: unknown[]; contests: unknown[] };
  announcements: unknown[];
  checklist: {
    steps: { id: string; done: boolean }[];
    doneCount: number;
    total: number;
    claimed: boolean;
    rewardBadge: string;
  };
}

async function fetchOverview(token: string): Promise<OverviewBody> {
  const res = await request(app)
    .get('/api/overview')
    .set({ Authorization: `Bearer ${token}` });
  expect(res.status).toBe(200);
  return unwrapOk<OverviewBody>(res);
}

describe('GET /api/overview', () => {
  beforeEach(resetUsers);

  it('新用户快照：钱包/2 学员/0 通关/5 人池/空动态/0-5 checklist', async () => {
    const user = await register();
    const ov = await fetchOverview(user.token);

    expect(ov.me.money).toBe(2500);
    expect(ov.me.reputation).toBe(10);
    expect(ov.me.onboardedAt).toEqual(expect.any(String));

    expect(ov.students.total).toBe(2);
    expect(ov.students.items).toHaveLength(2);

    expect(ov.story.clearedStages).toBe(0);
    expect(ov.story.totalStages).toBe(33);
    expect(ov.story.nextStage).toMatchObject({ stageKey: 'cspj:1', chapter: 'cspj' });

    expect(ov.pool.count).toBe(5);
    expect(ov.pool.refreshPrice).toBeGreaterThan(0);
    expect(Date.parse(ov.pool.freeRefreshAt)).toBeGreaterThan(Date.now());

    expect(ov.recent.training).toEqual([]);
    expect(ov.recent.lectures).toEqual([]);
    expect(ov.recent.adventures).toEqual([]);
    expect(ov.recent.contests).toEqual([]);
    expect(ov.announcements).toEqual([]);

    expect(ov.checklist.total).toBe(5);
    expect(ov.checklist.doneCount).toBe(0);
    expect(ov.checklist.claimed).toBe(false);
    expect(ov.checklist.rewardBadge).toBe('rookie-done');
    expect(ov.checklist.steps.map((s) => s.id)).toEqual([
      'train',
      'lecture',
      'adventure',
      'story',
      'recruit3',
    ]);
  });

  it('训练一次后 train 步骤完成且 recent.training 有 1 条', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };
    const [trainee] = await onboardingStudents(user.userId);
    const trained = await request(app)
      .post('/api/training/basic')
      .set(auth)
      .send({ studentId: trainee!.id });
    expect(trained.status).toBe(200);

    const ov = await fetchOverview(user.token);
    expect(ov.checklist.steps.find((s) => s.id === 'train')?.done).toBe(true);
    expect(ov.checklist.doneCount).toBe(1);
    expect(ov.recent.training).toHaveLength(1);
  });

  it('未认证 → 401', async () => {
    const res = await request(app).get('/api/overview');
    expect(res.status).toBe(401);
  });
});

/** 候选池只暴露九维与价格（品质档按 student.md §3.6 隐藏）：用六维和当强度代理。 */
const STRENGTH_DIMS = ['ds', 'dp', 'math', 'graph', 'greedy', 'str'] as const;

function strengthOf(attrs: Record<string, number>): number {
  return STRENGTH_DIMS.reduce((sum, dim) => sum + (attrs[dim] ?? 0), 0);
}

describe('POST /api/overview/checklist/claim', () => {
  beforeEach(resetUsers);

  /** 做完 5 步：GOOD 剧情+训练+讲课，COMMON 历练结算，再招第 3 人。返回剧情是否通关。 */
  async function completeAll(user: { token: string; userId: number }): Promise<boolean> {
    const auth = { Authorization: `Bearer ${user.token}` };
    await fundAdventurer(user.userId);
    const students = await onboardingStudents(user.userId);
    const good = students.find((s) => s.qualityTier === 'GOOD') ?? students[0]!;
    const other = students.find((s) => s.id !== good.id) ?? students[1]!;

    // 剧情/历练都要多人队伍：先补齐队伍人数（在册 2 人 + 招募 2 人），招每池最强的那个
    const recruitedIds: number[] = [];
    for (let index = 0; index < 2; index += 1) {
      const pool = unwrapOk<{ candidates: { tempId: string; attrs: Record<string, number> }[] }>(
        await request(app).get('/api/academy/pool').set(auth),
      );
      const strongest = [...pool.candidates].sort(
        (a, b) => strengthOf(b.attrs) - strengthOf(a.attrs),
      )[0]!;
      const recruited = unwrapOk<{ id: number }>(
        await request(app)
          .post('/api/academy/recruit')
          .set(auth)
          .send({ tempId: strongest.tempId }),
      );
      recruitedIds.push(recruited.id);
    }
    const roster = [good.id, other.id, ...recruitedIds];

    // 剧情：GOOD（V≈14）+ 满状态队伍打 cspj:1（NPC 10 队均值 8、通关线 rank ≤ 8），胜负随机
    const entered = await request(app)
      .post('/api/story/stages/cspj:1/enter')
      .set(auth)
      .send({ roster, ngLevel: 0, idempotencyKey: randomUUID() });
    expect(entered.status).toBe(200);
    // 未通关直接返回：本账号的体力/精力/心态已被这一场消耗，继续用只会更弱
    if (!(await stageCleared(user.token, 'cspj:1'))) return false;
    // 回体（药水 +3 保证后续训练 1 + 讲课 2 够用）
    const potion = await request(app)
      .post('/api/items/use')
      .set(auth)
      .send({ itemId: 'stamina-potion', studentId: good.id });
    expect(potion.status).toBe(200);

    const trained = await request(app)
      .post('/api/training/basic')
      .set(auth)
      .send({ studentId: good.id });
    expect(trained.status).toBe(200);

    // 讲课：入门组强接（V≈14 落 [7,15) 窗内；成败都落 log）
    const lectured = await request(app)
      .post('/api/academy/lectures')
      .set(auth)
      .send({ studentId: good.id, tier: 'beginner', force: true });
    expect(lectured.status).toBe(200);

    await resolveAdventure(user.token, [other.id, good.id, recruitedIds[0]!]);
    return true;
  }

  /**
   * 剧情通关是随机事件，输掉一场还会带走体力/精力/心态，原地带伤重试只会越打越弱。
   * 所以整段换新账号重来：每次都是满状态队伍的一次独立重掷。
   */
  async function completeAllFresh(): Promise<{ token: string; userId: number }> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const user = await register();
      if (await completeAll(user)) return user;
    }
    throw new Error('cspj:1 连 8 次满状态尝试都未通关');
  }

  it('未完成领取 → 409 STATE_CONFLICT', async () => {
    const user = await register();
    const res = await request(app)
      .post('/api/overview/checklist/claim')
      .set({ Authorization: `Bearer ${user.token}` });
    expect(res.status).toBe(409);
    expect(unwrapErr(res)).toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('5 步全完成 → 领取成功落徽章；重复领取幂等 already', async () => {
    const user = await completeAllFresh();

    const before = await fetchOverview(user.token);
    expect(before.checklist.doneCount).toBe(5);
    expect(before.checklist.claimed).toBe(false);

    const first = await request(app)
      .post('/api/overview/checklist/claim')
      .set({ Authorization: `Bearer ${user.token}` });
    expect(first.status).toBe(200);
    expect(unwrapOk<{ claimed: boolean; already: boolean; badge: string }>(first)).toEqual({
      claimed: true,
      already: false,
      badge: 'rookie-done',
    });
    const me = unwrapOk<{ badges: string[] }>(
      await request(app)
        .get('/api/users/me')
        .set({ Authorization: `Bearer ${user.token}` }),
    );
    expect(me.badges).toContain('rookie-done');

    const again = await request(app)
      .post('/api/overview/checklist/claim')
      .set({ Authorization: `Bearer ${user.token}` });
    expect(again.status).toBe(200);
    expect(unwrapOk<{ claimed: boolean; already: boolean }>(again).already).toBe(true);

    const after = await fetchOverview(user.token);
    expect(after.checklist.claimed).toBe(true);
  });

  it('领奖事务内重算：完成后开除至 2 人 → 409', async () => {
    const user = await completeAllFresh();
    // 开除至只剩 2 人（在册 <3 → recruit3 步骤回退）
    const students = await onboardingStudents(user.userId);
    for (const victim of students.slice(2)) {
      const dismissed = await request(app)
        .post(`/api/students/${victim.id}/dismiss`)
        .set({ Authorization: `Bearer ${user.token}` });
      expect(dismissed.status).toBe(200);
    }

    const res = await request(app)
      .post('/api/overview/checklist/claim')
      .set({ Authorization: `Bearer ${user.token}` });
    expect(res.status).toBe(409);
    expect(unwrapErr(res)).toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('未认证 → 401', async () => {
    const res = await request(app).post('/api/overview/checklist/claim');
    expect(res.status).toBe(401);
  });
});
