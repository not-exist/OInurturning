import path from 'node:path';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { parse as parseYaml } from 'yaml';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 剧情模式覆盖补强（story.test.ts 仅 1 用例）：
 * 多关解锁链、首通/复刷奖励语义、幂等重放、NG+ 解锁与加成、一周目结算、战报鉴权。
 * 需要完整八章配置 → 使用 docs/data，并在 afterAll 恢复 fixtures（后续 students/training 依赖 fixtures）。
 */
const app: Express = createApp();
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/config');
const DOCS = path.resolve(import.meta.dirname, '../../../docs/data');
let seq = 0;

beforeAll(async () => {
  await importConfigs({ configDir: DOCS });
});
beforeEach(resetUsers);
afterAll(async () => {
  await importConfigs({ configDir: FIXTURES });
});

interface Session {
  accessToken: string;
  me: { id: number };
}

interface OverviewStage {
  stageKey: string;
  unlocked: boolean;
  cleared: boolean;
  clearCount: number;
  bestRank: number | null;
  staminaCost: number;
}

interface Overview {
  ngLevel: number;
  chapters: Array<{ chapter: string; stages: OverviewStage[] }>;
  ngPlusUnlocked: boolean;
  maxUnlockedNgLevel: number;
}

interface EnterResult {
  record: {
    id: string;
    report: {
      pass: boolean;
      standings: Array<{ participantIndex: number; rank: number }>;
    };
    summary: { rank: number };
  };
  replayed: boolean;
  firstClear: boolean;
}

interface RewardLine {
  type: string;
  amount?: number;
  itemId?: string;
  count?: number;
}

async function register(): Promise<Session> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `storycov-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  return unwrapOk<Session>(res);
}

/** 满属性学员：cspj 章首通近乎必过（NPC 均值个位数），消除种子方差。 */
async function maxedStudent(userId: number): Promise<{ id: number }> {
  const student = await prisma.student.create({
    data: {
      userId,
      name: '满级学员',
      sex: 'MALE',
      qualityTier: 'GENIUS',
      ds: 100, dp: 100, math: 100, graph: 100, greedy: 100, str: 100,
      code: 100, thinking: 100, setting: 100,
      mindset: 10,
      focusCap: 100, energyMax: 100, energy: 100, stamina: 5, staminaRegen: 100,
    },
  });
  return { id: student.id };
}

async function refill(studentId: number): Promise<void> {
  await prisma.student.update({ where: { id: studentId }, data: { stamina: 5, energy: 100, mindset: 10 } });
}

async function enter(
  token: string,
  stageKey: string,
  studentId: number,
  key: string,
  ngLevel = 0,
): Promise<request.Response> {
  return request(app)
    .post(`/api/story/stages/${stageKey}/enter`)
    .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': key })
    .send({ roster: [studentId], ngLevel });
}

/** 以不同幂等键重试直到通关（满级打 cspj 通常一次即过，重试仅防极端种子）。 */
async function clearStage(
  token: string,
  stageKey: string,
  studentId: number,
  ngLevel = 0,
): Promise<EnterResult> {
  // 每次调用换新幂等键命名空间：同一用例内多次 clearStage 不可复用键（否则第二次命中 replay）
  seq += 1;
  const tag = seq;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await refill(studentId);
    const res = await enter(token, stageKey, studentId, `clear-${stageKey}-ng${ngLevel}-${attempt}-${tag}`, ngLevel);
    expect(res.status).toBe(200);
    const data = unwrapOk<EnterResult>(res);
    if (data.record.report.pass) return data;
  }
  throw new Error(`stage ${stageKey} ng${ngLevel} not cleared after retries`);
}

async function seedStages(userId: number, stageKeys: string[], ngLevel = 0): Promise<void> {
  await prisma.storyProgress.createMany({
    data: stageKeys.map((stageKey) => ({ userId, ngLevel, stageKey, clearCount: 1, bestRank: 1 })),
  });
}

interface StagesDoc {
  stages: Array<{ chapter: string; stage_index: number; first_clear: { money: number } }>;
}

const stagesDoc = parseYaml(readFileSync(path.join(DOCS, 'stages.yaml'), 'utf8')) as StagesDoc;

function yamlFirstClearMoney(chapter: string, index: number): number {
  const stage = stagesDoc.stages.find((s) => s.chapter === chapter && s.stage_index === index);
  if (!stage) throw new Error(`stage ${chapter}:${index} missing in docs/data/stages.yaml`);
  return stage.first_clear.money;
}

async function overview(token: string, ngLevel?: number): Promise<Overview> {
  const res = await request(app)
    .get(ngLevel === undefined ? '/api/story/overview' : `/api/story/overview?ngLevel=${ngLevel}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return unwrapOk<Overview>(res);
}

describe('story coverage：总览与解锁链', () => {
  it('总览含八章 33 关，仅第一章第一关解锁，体力耗按章节 1/2 点', async () => {
    const user = await register();
    const data = await overview(user.accessToken);
    expect(data.chapters.map((c) => c.chapter)).toEqual([
      'cspj', 'csps', 'noip', 'province', 'noi', 'ctt', 'cts', 'ioi',
    ]);
    const all = data.chapters.flatMap((c) => c.stages);
    expect(all).toHaveLength(33);
    expect(data.chapters[0]?.stages[0]).toMatchObject({ stageKey: 'cspj:1', unlocked: true, cleared: false });
    for (const stage of all) {
      if (stage.stageKey === 'cspj:1') continue;
      expect(stage.unlocked).toBe(false);
      expect(stage.cleared).toBe(false);
    }
    // stamina_cost_by_chapter：前四章 1 点、后四章 2 点（stages.yaml 口径）
    const costByChapter = new Map(data.chapters.map((c) => [c.chapter, c.stages[0]?.staminaCost]));
    expect([...costByChapter.entries()]).toEqual([
      ['cspj', 1], ['csps', 1], ['noip', 1], ['province', 1],
      ['noi', 2], ['ctt', 2], ['cts', 2], ['ioi', 2],
    ]);
    expect(data.ngPlusUnlocked).toBe(false);
    expect(data.maxUnlockedNgLevel).toBe(0);
  });

  it('锁定关卡 → STATE_CONFLICT；未知关卡 → NOT_FOUND', async () => {
    const user = await register();
    const student = await maxedStudent(user.me.id);
    const locked = await enter(user.accessToken, 'cspj:2', student.id, 'lock-1');
    expect(locked.status).toBe(409);
    expect(unwrapErr(locked)).toMatchObject({ code: 'STATE_CONFLICT' });
    const missing = await enter(user.accessToken, 'nope:99', student.id, 'lock-2');
    expect(missing.status).toBe(404);
    expect(unwrapErr(missing).code).toBe('NOT_FOUND');
  });

  it('参数校验：roster/幂等键/ngLevel 非法 → VALIDATION_FAILED', async () => {
    const user = await register();
    const student = await maxedStudent(user.me.id);
    const auth = { Authorization: `Bearer ${user.accessToken}` };

    const empty = await request(app).post('/api/story/stages/cspj:1/enter').set({ ...auth, 'Idempotency-Key': 'v-1' }).send({ roster: [] });
    expect(empty.status).toBe(400);
    const two = await request(app).post('/api/story/stages/cspj:1/enter').set({ ...auth, 'Idempotency-Key': 'v-2' }).send({ roster: [student.id, student.id] });
    expect(two.status).toBe(400);
    const noKey = await request(app).post('/api/story/stages/cspj:1/enter').set(auth).send({ roster: [student.id] });
    expect(noKey.status).toBe(400);
    expect(unwrapErr(noKey).code).toBe('VALIDATION_FAILED');
    const badNg = await request(app).post('/api/story/stages/cspj:1/enter').set({ ...auth, 'Idempotency-Key': 'v-3' }).send({ roster: [student.id], ngLevel: -1 });
    expect(badNg.status).toBe(400);
    const badQuery = await request(app).get('/api/story/overview?ngLevel=abc').set(auth);
    expect(badQuery.status).toBe(400);
    const badProgress = await request(app).get('/api/story/progress?ngLevel=-1').set(auth);
    expect(badProgress.status).toBe(400);
  });

  it('体力不足 → INSUFFICIENT_RESOURCE（need=关卡体力耗）', async () => {
    const user = await register();
    const student = await maxedStudent(user.me.id);
    await prisma.student.update({ where: { id: student.id }, data: { stamina: 0 } });
    const res = await enter(user.accessToken, 'cspj:1', student.id, 'stam-1');
    expect(res.status).toBe(409);
    const err = unwrapErr(res);
    expect(err.code).toBe('INSUFFICIENT_RESOURCE');
    expect(err.details).toMatchObject({ resource: 'stamina', need: 1 });
  });

  it('他人学员 → FORBIDDEN；已开除/不存在 → NOT_FOUND', async () => {
    const user = await register();
    const other = await register();
    const mine = await maxedStudent(user.me.id);
    const foreign = await maxedStudent(other.me.id);

    const forbidden = await enter(user.accessToken, 'cspj:1', foreign.id, 'own-1');
    expect(forbidden.status).toBe(403);
    const dismissed = await prisma.student.update({ where: { id: mine.id }, data: { status: 'DISMISSED' } });
    expect(dismissed.status).toBe('DISMISSED');
    const gone = await enter(user.accessToken, 'cspj:1', mine.id, 'own-2');
    expect(gone.status).toBe(404);
    const missing = await enter(user.accessToken, 'cspj:1', 99999999, 'own-3');
    expect(missing.status).toBe(404);
  });
});

describe('story coverage：首通与复刷', () => {
  it('首通：奖钱精确到账，进度/总览/战报/体力联动', async () => {
    const user = await register();
    const student = await maxedStudent(user.me.id);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.me.id } });
    const expectedMoney = yamlFirstClearMoney('cspj', 1);

    const data = await clearStage(user.accessToken, 'cspj:1', student.id);
    expect(data.replayed).toBe(false);
    expect(data.firstClear).toBe(true);

    const record = await request(app).get(`/api/records/${data.record.id}`).set('Authorization', `Bearer ${user.accessToken}`);
    expect(record.status).toBe(200);
    const view = unwrapOk<{ report: { format: string }; summary: { format: string; rank: number }; rewards: RewardLine[] }>(record);
    expect(view.report.format).toBe('RANKING');
    expect(view.summary.format).toBe('RANKING');
    expect(view.rewards).toContainEqual({ type: 'first_clear_money', amount: expectedMoney });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.me.id } });
    expect(after.money - before.money).toBe(expectedMoney);

    const progress = await request(app).get('/api/story/progress').set('Authorization', `Bearer ${user.accessToken}`);
    const rows = unwrapOk<Array<{ stageKey: string; clearCount: number; bestRank: number; firstClearAt: string }>>(progress);
    expect(rows).toEqual([
      expect.objectContaining({ stageKey: 'cspj:1', clearCount: 1 }),
    ]);
    const row = rows[0]!;
    expect(row.bestRank).toBeGreaterThanOrEqual(1);
    expect(row.bestRank).toBeLessThanOrEqual(8);
    expect(row.firstClearAt).toEqual(expect.any(String));

    const ov = await overview(user.accessToken);
    const cspj = ov.chapters[0]!.stages;
    expect(cspj[0]).toMatchObject({ stageKey: 'cspj:1', cleared: true, clearCount: 1 });
    expect(cspj[1]).toMatchObject({ stageKey: 'cspj:2', unlocked: true, cleared: false });

    const spent = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(spent.stamina).toBe(4);
  });

  it('复刷：无首通奖、clearCount 累加、bestRank 取历史最优', async () => {
    const user = await register();
    const student = await maxedStudent(user.me.id);
    const first = await clearStage(user.accessToken, 'cspj:1', student.id);
    const second = await clearStage(user.accessToken, 'cspj:1', student.id);
    expect(second.replayed).toBe(false);
    expect(second.firstClear).toBe(false);

    const record = await request(app).get(`/api/records/${second.record.id}`).set('Authorization', `Bearer ${user.accessToken}`);
    const rewards = unwrapOk<{ rewards: RewardLine[] }>(record).rewards;
    expect(rewards.some((r) => r.type.startsWith('first_clear'))).toBe(false);

    const progress = await request(app).get('/api/story/progress').set('Authorization', `Bearer ${user.accessToken}`);
    const row = unwrapOk<Array<{ clearCount: number; bestRank: number }>>(progress)[0]!;
    expect(row.clearCount).toBe(2);
    expect(row.bestRank).toBe(Math.min(first.record.summary.rank, second.record.summary.rank));
  });

  it('幂等键跨关复用 → 返回原记录（replay 优先于解锁检查）', async () => {
    const user = await register();
    const student = await maxedStudent(user.me.id);
    const firstRes = await enter(user.accessToken, 'cspj:1', student.id, 'cross-stage-key');
    expect(firstRes.status).toBe(200);
    const first = unwrapOk<EnterResult>(firstRes);
    const replayRes = await enter(user.accessToken, 'cspj:2', student.id, 'cross-stage-key');
    expect(replayRes.status).toBe(200);
    const replay = unwrapOk<EnterResult>(replayRes);
    expect(replay.replayed).toBe(true);
    expect(replay.firstClear).toBe(false);
    expect(replay.record.id).toBe(first.record.id);
  });

  it('战报鉴权：他人战报/不存在 → NOT_FOUND', async () => {
    const user = await register();
    const other = await register();
    const student = await maxedStudent(user.me.id);
    const data = await clearStage(user.accessToken, 'cspj:1', student.id);
    const foreign = await request(app).get(`/api/records/${data.record.id}`).set('Authorization', `Bearer ${other.accessToken}`);
    expect(foreign.status).toBe(404);
    const missing = await request(app).get('/api/records/does-not-exist').set('Authorization', `Bearer ${user.accessToken}`);
    expect(missing.status).toBe(404);
  });
});

describe('story coverage：NG+', () => {
  async function finalsOf(token: string): Promise<string[]> {
    const ov = await overview(token);
    return ov.chapters.map((c) => c.stages[c.stages.length - 1]!.stageKey);
  }

  it('未全通：NG+1 总览/参赛均拒绝', async () => {
    const user = await register();
    const student = await maxedStudent(user.me.id);
    const ov = await request(app).get('/api/story/overview?ngLevel=1').set('Authorization', `Bearer ${user.accessToken}`);
    expect(ov.status).toBe(409);
    expect(unwrapErr(ov).code).toBe('STATE_CONFLICT');
    const denied = await enter(user.accessToken, 'cspj:1', student.id, 'ng-locked', 1);
    expect(denied.status).toBe(409);
    expect(unwrapErr(denied).code).toBe('STATE_CONFLICT');
  });

  it('播种八章正赛 → NG+1 解锁而 NG+2 仍锁', async () => {
    const user = await register();
    await seedStages(user.me.id, await finalsOf(user.accessToken));
    const ov0 = await overview(user.accessToken);
    expect(ov0.maxUnlockedNgLevel).toBe(1);
    expect(ov0.ngPlusUnlocked).toBe(true);
    const ov1 = await overview(user.accessToken, 1);
    expect(ov1.ngLevel).toBe(1);
    expect(ov1.chapters[0]?.stages[0]).toMatchObject({ stageKey: 'cspj:1', unlocked: true });
    const ov2 = await request(app).get('/api/story/overview?ngLevel=2').set('Authorization', `Bearer ${user.accessToken}`);
    expect(ov2.status).toBe(409);
  });

  it('NG+1 首通奖钱 ×1.5，进度按层隔离', async () => {
    const user = await register();
    const student = await maxedStudent(user.me.id);
    await seedStages(user.me.id, await finalsOf(user.accessToken));
    const base = yamlFirstClearMoney('cspj', 1);

    const data = await clearStage(user.accessToken, 'cspj:1', student.id, 1);
    expect(data.firstClear).toBe(true);
    const record = await request(app).get(`/api/records/${data.record.id}`).set('Authorization', `Bearer ${user.accessToken}`);
    const rewards = unwrapOk<{ rewards: RewardLine[] }>(record).rewards;
    expect(rewards).toContainEqual({ type: 'first_clear_money', amount: Math.round(base * 1.5) });

    const auth = { Authorization: `Bearer ${user.accessToken}` };
    const ng1 = unwrapOk<Array<{ stageKey: string; ngLevel: number }>>(await request(app).get('/api/story/progress?ngLevel=1').set(auth));
    expect(ng1).toEqual([expect.objectContaining({ stageKey: 'cspj:1', ngLevel: 1 })]);
    const ng0 = unwrapOk<Array<{ stageKey: string; ngLevel: number }>>(await request(app).get('/api/story/progress?ngLevel=0').set(auth));
    expect(ng0.every((row) => row.ngLevel === 0)).toBe(true);
    expect(ng0.some((row) => row.stageKey === 'cspj:1')).toBe(false);
  });

  it('真实一周目：补齐最后一关 → 徽章/奖杯/结算金/NG 解锁', async () => {
    const user = await register();
    const student = await maxedStudent(user.me.id);
    const ov = await overview(user.accessToken);
    const allKeys = ov.chapters.flatMap((c) => c.stages.map((s) => s.stageKey));
    expect(allKeys).toHaveLength(33);
    await seedStages(
      user.me.id,
      allKeys.filter((key) => key !== 'cspj:4'),
    );
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.me.id } });

    const data = await clearStage(user.accessToken, 'cspj:4', student.id);
    expect(data.firstClear).toBe(true);

    const record = await request(app).get(`/api/records/${data.record.id}`).set('Authorization', `Bearer ${user.accessToken}`);
    const rewards = unwrapOk<{ rewards: RewardLine[] }>(record).rewards;
    expect(rewards).toContainEqual({ type: 'first_clear_item', itemId: 'trophy-gold', count: 1 });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.me.id } });
    expect((after.badges as string[])).toContain('badge-legend');
    // full_clear.money=500000 + 本关首通奖，增量必 ≥500000（stages.yaml 口径）
    expect(after.money - before.money).toBeGreaterThanOrEqual(500000);
    const trophy = await prisma.userItem.findUnique({ where: { userId_itemId: { userId: user.me.id, itemId: 'trophy-gold' } } });
    expect(trophy?.quantity).toBeGreaterThanOrEqual(1);

    const unlocked = await overview(user.accessToken);
    expect(unlocked.maxUnlockedNgLevel).toBe(1);
    expect(unlocked.ngPlusUnlocked).toBe(true);
  });
});
