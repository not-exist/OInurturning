import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';
import type { ProblemView } from '../src/modules/problems/service.js';
import type { TalentView } from '../src/modules/talents/service.js';

const app: Express = createApp();

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let userSeq = 0;
async function createAuthedUser(): Promise<{ userId: number; token: string }> {
  userSeq += 1;
  const username = `pv-${Date.now().toString(36)}-${userSeq}`;
  const res = await request(app).post('/api/auth/register').send({ username, password: 'pw-123456' });
  const { accessToken, me } = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { userId: me.id, token: accessToken };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function giveProblem(userId: number, overrides: Record<string, unknown> = {}): Promise<number> {
  const p = await prisma.problemLibraryEntry.create({
    data: { userId, name: '预制题', dominantDim: 'DS', rarity: 'green', quality: 60, ...overrides },
  });
  return p.id;
}

// ---------------------------------------------------------------------------
// GET /api/problems
// ---------------------------------------------------------------------------

describe('GET /api/problems', () => {
  beforeEach(resetUsers);

  it('仅列出本人未消耗的预制题，字段 + createdAt 排序 + rarity 归一为大写', async () => {
    const a = await createAuthedUser();
    const b = await createAuthedUser();
    // 用户 a 两题，其一已消耗；用户 b 一题（不应出现）
    await giveProblem(a.userId, { name: '题A', dominantDim: 'DP', rarity: 'colorful', quality: 80, createdAt: new Date('2026-01-01') });
    await giveProblem(a.userId, { name: '题B-已消耗', consumedAt: new Date(), createdAt: new Date('2026-01-02') });
    await giveProblem(a.userId, { name: '题C', dominantDim: 'STRING', rarity: 'yellow', quality: 40, createdAt: new Date('2026-01-03') });
    await giveProblem(b.userId, { name: '他人题' });

    const res = await request(app).get('/api/problems').set(auth(a.token));
    expect(res.status).toBe(200);
    const list = unwrapOk<ProblemView[]>(res);
    expect(list.map((p) => p.name)).toEqual(['题A', '题C']); // 排除已消耗与用户 b

    const [first] = list;
    expect(first.id).toBeTypeOf('number');
    expect(first.name).toBe('题A');
    expect(first.dim).toBe('DP');
    expect(first.rarity).toBe('RAINBOW'); // colorful → RAINBOW
    expect(first.quality).toBe(80);
    expect(first.consumedAt).toBeNull();

    expect(list[1].rarity).toBe('YELLOW');
  });

  it('无题 → 返回空数组', async () => {
    const u = await createAuthedUser();
    const res = await request(app).get('/api/problems').set(auth(u.token));
    expect(unwrapOk<ProblemView[]>(res)).toEqual([]);
  });

  it('未认证 → 401', async () => {
    const res = await request(app).get('/api/problems');
    expect(res.status).toBe(401);
    expect(unwrapErr(res).code).toBe('UNAUTHENTICATED');
  });
});

// ---------------------------------------------------------------------------
// GET /api/talents
// ---------------------------------------------------------------------------

describe('GET /api/talents', () => {
  beforeEach(resetUsers);

  it('返回 CONFIG.talents 全量目录，rarity 归一为大写，含 desc/family/effects', async () => {
    const u = await createAuthedUser();
    const res = await request(app).get('/api/talents').set(auth(u.token));
    expect(res.status).toBe(200);
    const list = unwrapOk<TalentView[]>(res);

    // fixtures/talents.yaml 三个天赋
    expect(list.map((t) => t.id).sort()).toEqual(['focus-green', 'focus-yellow', 'slump-gray']);

    const yellow = list.find((t) => t.id === 'focus-yellow')!;
    expect(yellow.name).toBe('专注');
    expect(yellow.rarity).toBe('YELLOW');
    expect(yellow.kind).toBe('positive');
    expect(yellow.family).toBe('focus');
    expect(yellow.desc).toContain('黄');
    expect(yellow.effects.length).toBeGreaterThan(0);

    const gray = list.find((t) => t.id === 'slump-gray')!;
    expect(gray.rarity).toBe('GRAY');
    expect(gray.family).toBeNull(); // 可空 family 保留 null
  });

  it('未认证 → 401', async () => {
    const res = await request(app).get('/api/talents');
    expect(res.status).toBe(401);
    expect(unwrapErr(res).code).toBe('UNAUTHENTICATED');
  });
});
