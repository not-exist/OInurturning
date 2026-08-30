import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { ConfigRarity, TalentDef } from '@oinur/shared';
import { createApp } from '../src/index.js';
import { mulberry32 } from '../src/lib/rng.js';
import { dayKey } from '../src/lib/clock.js';
import { prisma } from '../src/lib/prisma.js';
import {
  QUALITY_HINTS,
  bucketTalents,
  generateCandidate,
  generatePool,
  qualityWeights,
  recruitPrice,
  refreshPrice,
  repAdjustedE,
  rollTalentIds,
  type CandidatePayload,
  type GenerateContext,
  type TalentBuckets,
} from '../src/modules/academy/recruit-gen.js';
import { NAME_POOL } from '../src/modules/academy/name-pool.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

const app: Express = createApp();

// ---------------------------------------------------------------------------
// recruit-gen 纯函数（种子随机可复现）
// ---------------------------------------------------------------------------

const RECRUITMENT = {
  recruit_base: 300,
  recruit_growth: 1.35,
  quality_mult: { common: 1.0, good: 1.5, elite: 2.5, genius: 5.0 },
};
const MANUAL_REFRESH = { refresh_base: 100, refresh_growth: 1.5, daily_price_cap: 800 };

function makeTalent(id: string, rarity: ConfigRarity): TalentDef {
  return {
    id,
    name: id,
    rarity,
    kind: rarity === 'gray' ? 'negative' : 'positive',
    family: null,
    effects: [{ stat: 'dp', mode: 'percent', value: 1 }],
    description: id,
    upgrade_to: null,
  };
}

/** 六档各 3 条的合成天赋表 */
function fullBuckets(): TalentBuckets {
  const rarities: ConfigRarity[] = ['gray', 'yellow', 'green', 'blue', 'purple', 'colorful'];
  const talents = Object.fromEntries(
    rarities.flatMap((r) => [1, 2, 3].map((i) => {
      const t = makeTalent(`${r}-t${i}`, r);
      return [t.id, t];
    })),
  );
  return bucketTalents(talents);
}

function genCtx(overrides: Partial<GenerateContext> = {}): GenerateContext {
  return { reputation: 0, ownedStudents: 0, buckets: fullBuckets(), recruitment: RECRUITMENT, ...overrides };
}

describe('recruit-gen：品质权重（student.md §3.2）', () => {
  it('rep=0 归一化为 55/30/12/3', () => {
    const w = qualityWeights(0);
    expect(w.common).toBeCloseTo(0.55, 10);
    expect(w.good).toBeCloseTo(0.3, 10);
    expect(w.elite).toBeCloseTo(0.12, 10);
    expect(w.genius).toBeCloseTo(0.03, 10);
  });

  it('rep=8000 与文档示例一致（41.2/33.0/19.2/6.6），且 genius 概率单调高于 rep=0', () => {
    const w = qualityWeights(8000);
    expect(w.common).toBeCloseTo(0.412, 2);
    expect(w.good).toBeCloseTo(0.33, 2);
    expect(w.elite).toBeCloseTo(0.192, 2);
    expect(w.genius).toBeCloseTo(0.066, 2);
    expect(w.genius).toBeGreaterThan(qualityWeights(0).genius);
    // 超界截断
    expect(qualityWeights(99999)).toEqual(w);
  });

  it('repAdjustedE：rep=6000 封顶 +15%（genius 六维 32→37），仅九维能力受用', () => {
    expect(repAdjustedE(32, 0)).toBe(32);
    expect(repAdjustedE(32, 6000)).toBe(37);
    expect(repAdjustedE(32, 99999)).toBe(37);
  });
});

describe('recruit-gen：价格（economy.yaml 口径，数值注入）', () => {
  it('招募费：round(300×1.35^N)×quality_mult（N=在册数）', () => {
    expect(recruitPrice(RECRUITMENT, 0, 'common')).toBe(300);
    expect(recruitPrice(RECRUITMENT, 1, 'common')).toBe(405);
    expect(recruitPrice(RECRUITMENT, 2, 'common')).toBe(547);
    expect(recruitPrice(RECRUITMENT, 0, 'good')).toBe(450);
    expect(recruitPrice(RECRUITMENT, 0, 'elite')).toBe(750);
    expect(recruitPrice(RECRUITMENT, 0, 'genius')).toBe(1500);
    expect(recruitPrice(RECRUITMENT, 2, 'good')).toBe(Math.round(547 * 1.5));
  });

  it('刷新费序列 100/150/225/338/506/759，之后封顶 800', () => {
    const seq = [0, 1, 2, 3, 4, 5, 6, 7, 10].map((k) => refreshPrice(MANUAL_REFRESH, k));
    expect(seq).toEqual([100, 150, 225, 338, 506, 759, 800, 800, 800]);
  });
});

describe('recruit-gen：候选生成（§3.3–3.6）', () => {
  it('同种子生成完全可复现', () => {
    const a = generatePool(mulberry32(42), genCtx());
    const b = generatePool(mulberry32(42), genCtx());
    expect(a).toEqual(b);
  });

  it('一池 5 人，tempId 互异，hint 与品质档映射正确（§3.6）', () => {
    const pool = generatePool(mulberry32(7), genCtx());
    expect(pool).toHaveLength(5);
    expect(new Set(pool.map((c) => c.tempId)).size).toBe(5);
    for (const c of pool) {
      expect(c.hint).toBe(QUALITY_HINTS[c.qualityTier.toLowerCase() as keyof typeof QUALITY_HINTS]);
      expect(['MALE', 'FEMALE']).toContain(c.sex);
      expect(NAME_POOL).toContain(c.name);
    }
  });

  it('属性落在 [E′−δ, E′+δ] 且截断 [1,100]；price=round(300×1.35^N)×mult', () => {
    const ctx = genCtx({ reputation: 6000, ownedStudents: 2 });
    for (let seed = 0; seed < 200; seed++) {
      const c = generateCandidate(mulberry32(seed), 'c0', ctx);
      const tierTable = {
        COMMON: { dim: 8, d: 4, mult: 1.0 },
        GOOD: { dim: 14, d: 5, mult: 1.5 },
        ELITE: { dim: 22, d: 6, mult: 2.5 },
        GENIUS: { dim: 32, d: 8, mult: 5.0 },
      }[c.qualityTier];
      const e = repAdjustedE(tierTable.dim, 6000);
      for (const v of [c.attrs.ds, c.attrs.dp, c.attrs.math, c.attrs.graph, c.attrs.greedy, c.attrs.str]) {
        expect(v).toBeGreaterThanOrEqual(Math.max(1, e - tierTable.d));
        expect(v).toBeLessThanOrEqual(Math.min(100, e + tierTable.d));
      }
      expect(c.price).toBe(Math.round(547 * tierTable.mult));
    }
  });

  it('genius 第 1 槽保证绿及以上（§3.4 保底）', () => {
    const buckets = fullBuckets();
    const rank = new Map(['gray', 'yellow', 'green', 'blue', 'purple', 'colorful'].map((r, i) => [r, i]));
    for (let seed = 0; seed < 300; seed++) {
      const ids = rollTalentIds(mulberry32(seed), 'genius', buckets);
      expect(ids.length).toBeGreaterThanOrEqual(1);
      const first = Object.values(buckets.byRarity).flat().find((t) => t.id === ids[0])!;
      expect(rank.get(first.rarity)!).toBeGreaterThanOrEqual(rank.get('green')!);
      expect(new Set(ids).size).toBe(ids.length); // 去重
    }
  });

  it('天赋去重：池小于槽数时不重复、不报错', () => {
    const buckets = bucketTalents({ only: makeTalent('only', 'green') });
    // elite 数量表可出 3 槽，但可用天赋仅 1 条
    for (let seed = 0; seed < 100; seed++) {
      const ids = rollTalentIds(mulberry32(seed), 'elite', buckets);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// API：/api/academy（懒刷新 / 手动刷新 / 招募）
// ---------------------------------------------------------------------------

interface AuthedUser {
  userId: number;
  token: string;
}

let userSeq = 0;
async function createAuthedUser(money: number, reputation = 0): Promise<AuthedUser> {
  userSeq += 1;
  const username = `ac-${Date.now().toString(36)}-${userSeq}`;
  const res = await request(app).post('/api/auth/register').send({ username, password: 'pw-123456' });
  const { accessToken, me } = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  await prisma.user.update({ where: { id: me.id }, data: { money, reputation } });
  return { userId: me.id, token: accessToken };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface PoolViewBody {
  candidates: CandidatePayload[];
  generatedAt: string;
  refreshesToday: number;
  refreshPrice: number;
}

async function getPool(token: string): Promise<PoolViewBody> {
  const res = await request(app).get('/api/academy/pool').set(auth(token));
  return unwrapOk<PoolViewBody>(res);
}

describe('GET /api/academy/pool', () => {
  beforeEach(resetUsers);

  it('首次访问建池：5 候选含 hint/attrs/talents/price；24h 内再访问不重生成', async () => {
    const u = await createAuthedUser(0);
    const first = await getPool(u.token);
    expect(first.candidates).toHaveLength(5);
    expect(first.refreshesToday).toBe(0);
    expect(first.refreshPrice).toBe(100);
    for (const c of first.candidates) {
      expect(c.hint).toMatch(/气质普通|身手不凡|锋芒毕露/);
      expect(c.attrs.ds).toBeGreaterThanOrEqual(1);
      expect(c.price).toBeGreaterThan(0);
    }

    const second = await getPool(u.token);
    expect(second.candidates.map((c) => c.tempId)).toEqual(first.candidates.map((c) => c.tempId));
    expect(second.generatedAt).toBe(first.generatedAt);
  });

  it('懒刷新：距 generatedAt ≥24h 自动重生成；23h 不动', async () => {
    const u = await createAuthedUser(0);
    const first = await getPool(u.token);
    const t0 = new Date(first.generatedAt);

    // 23h：未到期，不重生成
    await prisma.recruitPool.update({
      where: { userId: u.userId },
      data: { generatedAt: new Date(Date.now() - 23 * 3_600_000) },
    });
    const same = await getPool(u.token);
    expect(same.candidates.map((c) => c.tempId)).toEqual(first.candidates.map((c) => c.tempId));
    expect(new Date(same.generatedAt).getTime()).toBeLessThan(Date.now() - 22 * 3_600_000);

    // 24h 整：到期，重生成
    await prisma.recruitPool.update({
      where: { userId: u.userId },
      data: { generatedAt: new Date(Date.now() - 24 * 3_600_000) },
    });
    const regenerated = await getPool(u.token);
    expect(new Date(regenerated.generatedAt).getTime()).toBeGreaterThan(t0.getTime());
    expect(new Date(regenerated.generatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('未认证 → 401', async () => {
    const res = await request(app).get('/api/academy/pool');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/academy/refresh', () => {
  beforeEach(resetUsers);

  it('按 100/150 序列扣钱并换新池；视图给出下一档价格', async () => {
    const u = await createAuthedUser(1000);
    await getPool(u.token);

    const r1 = await request(app).post('/api/academy/refresh').set(auth(u.token));
    const v1 = unwrapOk<PoolViewBody>(r1);
    expect(v1.refreshesToday).toBe(1);
    expect(v1.refreshPrice).toBe(150);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).money).toBe(900);

    const r2 = await request(app).post('/api/academy/refresh').set(auth(u.token));
    const v2 = unwrapOk<PoolViewBody>(r2);
    expect(v2.refreshesToday).toBe(2);
    expect(v2.refreshPrice).toBe(225);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).money).toBe(750);
  });

  it('钱不足 → 409 INSUFFICIENT_RESOURCE，池与计数不变', async () => {
    const u = await createAuthedUser(50);
    const before = await getPool(u.token);
    const res = await request(app).post('/api/academy/refresh').set(auth(u.token));
    expect(res.status).toBe(409);
    expect(unwrapErr(res).code).toBe('INSUFFICIENT_RESOURCE');
    const after = await getPool(u.token);
    expect(after.refreshesToday).toBe(0);
    expect(after.candidates.map((c) => c.tempId)).toEqual(before.candidates.map((c) => c.tempId));
  });

  it('04:00 日界跨天后刷新计数重置（k 从 0 重计）', async () => {
    const u = await createAuthedUser(1000);
    await getPool(u.token);
    // 伪造「昨日已刷 5 次」
    const yesterday = dayKey(new Date(Date.now() - 24 * 3_600_000));
    await prisma.recruitPool.update({
      where: { userId: u.userId },
      data: { refreshesToday: 5, refreshDayKey: yesterday },
    });
    const res = await request(app).post('/api/academy/refresh').set(auth(u.token));
    const v = unwrapOk<PoolViewBody>(res);
    expect(v.refreshesToday).toBe(1); // 按 k=0 收 100 后计 1
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).money).toBe(900);
  });
});

describe('POST /api/academy/recruit', () => {
  beforeEach(resetUsers);

  it('招募：扣钱（重算价=快照价）→ 建学员+天赋落库 → 池减员', async () => {
    const u = await createAuthedUser(10_000);
    const pool = await getPool(u.token);
    const target = pool.candidates[0]!;

    const res = await request(app)
      .post('/api/academy/recruit')
      .set(auth(u.token))
      .send({ tempId: target.tempId });
    const view = unwrapOk<{ id: number; name: string; qualityTier: string; talents: string[]; mindset: number }>(res);
    expect(view.name).toBe(target.name);
    expect(view.qualityTier).toBe(target.qualityTier);
    expect(view.mindset).toBe(2);
    expect(view.talents).toEqual(target.talents.map((t) => t.talentId));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(user.money).toBe(10_000 - target.price);

    const student = await prisma.student.findUniqueOrThrow({
      where: { id: view.id },
      include: { talents: true },
    });
    expect(student.qualityTier).toBe(target.qualityTier);
    expect(student.talents.map((t) => t.talentId).sort()).toEqual(
      target.talents.map((t) => t.talentId).sort(),
    );
    for (const t of student.talents) expect(t.acquiredVia).toBe('RECRUIT');

    const after = await getPool(u.token);
    expect(after.candidates).toHaveLength(4);
    expect(after.candidates.find((c) => c.tempId === target.tempId)).toBeUndefined();
  });

  it('已有 1 名在册学员时按 N=1 重算价（round(300×1.35)×mult）', async () => {
    const u = await createAuthedUser(10_000);
    const pool = await getPool(u.token);
    // 先招一名 → N 变 1
    await request(app)
      .post('/api/academy/recruit')
      .set(auth(u.token))
      .send({ tempId: pool.candidates[0]!.tempId });
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).money;

    const second = pool.candidates[1]!;
    const mult = { COMMON: 1.0, GOOD: 1.5, ELITE: 2.5, GENIUS: 5.0 }[second.qualityTier];
    const expected = Math.round(405 * mult);
    const res = await request(app)
      .post('/api/academy/recruit')
      .set(auth(u.token))
      .send({ tempId: second.tempId });
    expect(res.status).toBe(200);
    const after = (await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).money;
    expect(before - after).toBe(expected);
  });

  it('钱不足 → 409 INSUFFICIENT_RESOURCE，学员不建、池不减员', async () => {
    const u = await createAuthedUser(1);
    const pool = await getPool(u.token);
    const res = await request(app)
      .post('/api/academy/recruit')
      .set(auth(u.token))
      .send({ tempId: pool.candidates[0]!.tempId });
    expect(res.status).toBe(409);
    expect(unwrapErr(res).code).toBe('INSUFFICIENT_RESOURCE');
    expect(await prisma.student.count({ where: { userId: u.userId } })).toBe(0);
    expect((await getPool(u.token)).candidates).toHaveLength(5);
  });

  it('tempId 不存在 → 404 NOT_FOUND；重复招募同一 tempId → 404', async () => {
    const u = await createAuthedUser(10_000);
    const pool = await getPool(u.token);
    const ghost = await request(app)
      .post('/api/academy/recruit')
      .set(auth(u.token))
      .send({ tempId: 'nope' });
    expect(ghost.status).toBe(404);
    expect(unwrapErr(ghost).code).toBe('NOT_FOUND');

    const tempId = pool.candidates[0]!.tempId;
    await request(app).post('/api/academy/recruit').set(auth(u.token)).send({ tempId });
    const again = await request(app)
      .post('/api/academy/recruit')
      .set(auth(u.token))
      .send({ tempId });
    expect(again.status).toBe(404);
  });

  it('body 缺 tempId → 400 VALIDATION_FAILED', async () => {
    const u = await createAuthedUser(0);
    const res = await request(app).post('/api/academy/recruit').set(auth(u.token)).send({});
    expect(res.status).toBe(400);
    expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
  });
});
