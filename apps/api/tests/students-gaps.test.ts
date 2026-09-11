import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapOk } from './helpers.js';

/**
 * 学员补白（students.test.ts 覆盖列表/详情/改名/开除主路径与罚则表）：
 * 已开除学员详情可见、改名缺参、开除后改名。
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
    .send({ username: `stugap-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { token: session.accessToken, userId: session.me.id };
}

async function makeStudent(userId: number): Promise<{ id: number }> {
  const student = await prisma.student.create({
    data: {
      userId, name: '补白学员', sex: 'MALE', qualityTier: 'COMMON',
      ds: 10, dp: 10, math: 10, graph: 10, greedy: 10, str: 10, code: 10, thinking: 10, setting: 10,
      focusCap: 20, energyMax: 50, energy: 50, staminaRegen: 10,
    },
  });
  return { id: student.id };
}

describe('students gaps', () => {
  it('已开除学员详情仍对本人可见（含 DISMISSED 状态与开除时间）', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const dismiss = await request(app).post(`/api/students/${student.id}/dismiss`).set(auth);
    expect(dismiss.status).toBe(200);
    const detail = await request(app).get(`/api/students/${student.id}`).set(auth);
    expect(detail.status).toBe(200);
    const view = unwrapOk<{ status: string; dismissedAt: string | null }>(detail);
    expect(view.status).toBe('DISMISSED');
    expect(view.dismissedAt).toEqual(expect.any(String));
  });

  it('改名缺 name → 400', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    const res = await request(app)
      .post(`/api/students/${student.id}/rename`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('开除后改名 → 404', async () => {
    const user = await register();
    const student = await makeStudent(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    await prisma.userItem.create({ data: { userId: user.userId, itemId: 'rename-card', quantity: 1 } });
    const dismiss = await request(app).post(`/api/students/${student.id}/dismiss`).set(auth);
    expect(dismiss.status).toBe(200);
    const rename = await request(app).post(`/api/students/${student.id}/rename`).set(auth).send({ name: '新名字' });
    expect(rename.status).toBe(404);
  });
});
