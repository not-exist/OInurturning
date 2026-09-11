import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 讲课补白（lecture.test.ts 覆盖档位/溢出/强接窗口/次数限制/HTTP）：
 * 参数校验、体力不足、档位可用性、精确结算锚点、声誉曲线封顶、强接声誉分支穷举、归属。
 * 需 economy.lecture（fixtures 仅 note 占位）→ docs/data，事后恢复 fixtures。
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

async function register(): Promise<{ token: string; userId: number }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `lecgap-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { token: session.accessToken, userId: session.me.id };
}

/** computeV = floor((code+thinking+floor(六维均值))/3)，全等值 v 即 V=v。 */
async function makeStudent(userId: number, v: number): Promise<{ id: number }> {
  const student = await prisma.student.create({
    data: {
      userId, name: `讲师 V${v}`, sex: 'MALE', qualityTier: 'COMMON',
      ds: v, dp: v, math: v, graph: v, greedy: v, str: v, code: v, thinking: v, setting: v,
      focusCap: 20, energyMax: 50, energy: 50, staminaRegen: 10,
    },
  });
  return { id: student.id };
}

interface LectureResult {
  teachingValue: number;
  forced: boolean;
  success: boolean;
  money: number;
  reputation: number;
  staminaAfter: number | null;
}

describe('lecture gaps', () => {
  it('无效档位/历史上限 → VALIDATION_FAILED', async () => {
    const user = await register();
    const student = await makeStudent(user.userId, 50);
    const auth = { Authorization: `Bearer ${user.token}` };
    const badTier = await request(app).post('/api/academy/lectures').set(auth).send({ studentId: student.id, tier: 'phd' });
    expect(badTier.status).toBe(400);
    const zero = await request(app).get('/api/academy/lectures?limit=0').set(auth);
    expect(zero.status).toBe(400);
    const over = await request(app).get('/api/academy/lectures?limit=101').set(auth);
    expect(over.status).toBe(400);
  });

  it('体力不足（<2）→ INSUFFICIENT_RESOURCE', async () => {
    const user = await register();
    const student = await makeStudent(user.userId, 50);
    await prisma.student.update({ where: { id: student.id }, data: { stamina: 1 } });
    const res = await request(app)
      .post('/api/academy/lectures')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: student.id, tier: 'beginner' });
    expect(res.status).toBe(409);
    expect(unwrapErr(res)).toMatchObject({ code: 'INSUFFICIENT_RESOURCE', details: { resource: 'stamina', need: 2 } });
  });

  it('弱学员（V=1）：全部五档 unavailable', async () => {
    const user = await register();
    await makeStudent(user.userId, 1);
    const tiers = unwrapOk<Array<{ id: string; available: boolean }>>(
      await request(app).get('/api/academy/lecture-tiers').set('Authorization', `Bearer ${user.token}`),
    );
    expect(tiers).toHaveLength(5);
    expect(tiers.every((t) => t.available === false)).toBe(true);
  });

  it('精确结算：beginner + V=20 + rep=0 → 72 金/1 誉/体力 3', async () => {
    const user = await register();
    const student = await makeStudent(user.userId, 20);
    const res = await request(app)
      .post('/api/academy/lectures')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: student.id, tier: 'beginner' });
    expect(res.status).toBe(200);
    // base 60 × repMult(1) × overflow(1+1×0.2)=72；声誉 round(1×1.2)=1
    expect(unwrapOk<LectureResult>(res)).toMatchObject({
      teachingValue: 20, forced: false, success: true, money: 72, reputation: 1, staminaAfter: 3,
    });
    const me = unwrapOk<{ money: number; reputation: number }>(
      await request(app).get('/api/users/me').set('Authorization', `Bearer ${user.token}`),
    );
    expect(me).toMatchObject({ money: 72, reputation: 1 });
  });

  it('声誉曲线封顶：rep=1000 → ×3，beginner + V=20 → 216 金', async () => {
    const user = await register();
    const student = await makeStudent(user.userId, 20);
    await prisma.user.update({ where: { id: user.userId }, data: { reputation: 1000 } });
    const res = await request(app)
      .post('/api/academy/lectures')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: student.id, tier: 'beginner' });
    expect(res.status).toBe(200);
    expect(unwrapOk<LectureResult>(res).money).toBe(216);
  });

  it('强接声誉分支穷举：rep=5 → 扣 1 或 2；rep=0 永不为负', async () => {
    const user = await register();
    const student = await makeStudent(user.userId, 10); // beginner 门槛 15，V=10 落强接窗 [7,15)
    await prisma.user.update({ where: { id: user.userId }, data: { reputation: 5 } });
    const res = await request(app)
      .post('/api/academy/lectures')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: student.id, tier: 'beginner', force: true });
    expect(res.status).toBe(200);
    const view = unwrapOk<LectureResult>(res);
    expect(view.forced).toBe(true);
    // 成功 −ordinal(1)；失败 −2×ordinal(1)，穷举两支
    expect([-1, -2]).toContain(view.reputation);
    const me = unwrapOk<{ reputation: number }>(
      await request(app).get('/api/users/me').set('Authorization', `Bearer ${user.token}`),
    );
    expect(me.reputation).toBe(5 + view.reputation);

    const poor = await register();
    const weak = await makeStudent(poor.userId, 10);
    const res2 = await request(app)
      .post('/api/academy/lectures')
      .set('Authorization', `Bearer ${poor.token}`)
      .send({ studentId: weak.id, tier: 'beginner', force: true });
    expect(res2.status).toBe(200);
    expect(unwrapOk<LectureResult>(res2).reputation).toBe(0);
    const me2 = unwrapOk<{ reputation: number }>(
      await request(app).get('/api/users/me').set('Authorization', `Bearer ${poor.token}`),
    );
    expect(me2.reputation).toBe(0);
  });

  it('他人学员 → FORBIDDEN；不存在 → NOT_FOUND', async () => {
    const user = await register();
    const other = await register();
    const foreign = await makeStudent(other.userId, 50);
    const denied = await request(app)
      .post('/api/academy/lectures')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: foreign.id, tier: 'beginner' });
    expect(denied.status).toBe(403);
    const missing = await request(app)
      .post('/api/academy/lectures')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: 99999999, tier: 'beginner' });
    expect(missing.status).toBe(404);
  });
});
