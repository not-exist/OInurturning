import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { getConfig, importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 出题题库补白（problem-library.test.ts 覆盖确定性质量/日限/归属删除/HTTP）：
 * 质量公式边界、稀有度与命名派生、费用锚点、容量上限、删除已消耗、资源不足、特性合法性。
 * 出题公式与费用为硬编码（非配置项），用 docs/data 并保持（与前后文件一致）。
 */
const app: Express = createApp();
const DOCS = path.resolve(import.meta.dirname, '../../../docs/data');
let seq = 0;

beforeAll(async () => {
  await importConfigs({ configDir: DOCS });
});
beforeEach(resetUsers);

async function register(money = 100000): Promise<{ token: string; userId: number }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `probgap-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  if (money > 0) await prisma.user.update({ where: { id: session.me.id }, data: { money } });
  return { token: session.accessToken, userId: session.me.id };
}

async function makeStudent(userId: number, ability: number): Promise<{ id: number }> {
  const student = await prisma.student.create({
    data: {
      userId, name: `出题人 ${ability}`, sex: 'MALE', qualityTier: 'COMMON',
      ds: ability, dp: ability, math: ability, graph: ability, greedy: ability, str: ability,
      code: ability, thinking: ability, setting: ability,
      focusCap: 20, energyMax: 50, energy: 50, staminaRegen: 10,
    },
  });
  return { id: student.id };
}

interface ProblemView {
  id: number;
  name: string;
  dominantDim: string;
  rarity: string;
  quality: number;
  traitId: string | null;
  cost: number;
  staminaAfter: number;
}

function expectedRarity(quality: number): string {
  if (quality < 30) return 'GRAY';
  if (quality < 50) return 'YELLOW';
  if (quality < 70) return 'GREEN';
  if (quality < 85) return 'BLUE';
  if (quality < 95) return 'PURPLE';
  return 'RAINBOW';
}

describe('problems gaps', () => {
  it('质量公式边界：满属性 ≥92；零属性 ≤9；稀有度/命名派生一致', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };
    const strong = await makeStudent(user.userId, 100);
    const strongRes = await request(app).post('/api/problem-library').set(auth).send({ studentId: strong.id, dimension: 'DS' });
    expect(strongRes.status).toBe(200);
    const hq = unwrapOk<ProblemView>(strongRes);
    // round(0.55×100+0.25×100+0.2×100+噪声[-8,9)) → [92,100]
    expect(hq.quality).toBeGreaterThanOrEqual(92);
    expect(hq.quality).toBeLessThanOrEqual(100);

    const weakUser = await register();
    const weak = await makeStudent(weakUser.userId, 0);
    const weakRes = await request(app)
      .post('/api/problem-library')
      .set('Authorization', `Bearer ${weakUser.token}`)
      .send({ studentId: weak.id, dimension: 'DS' });
    expect(weakRes.status).toBe(200);
    const lq = unwrapOk<ProblemView>(weakRes);
    // round(噪声[-8,9)) → clamp [0,9]
    expect(lq.quality).toBeGreaterThanOrEqual(0);
    expect(lq.quality).toBeLessThanOrEqual(9);

    for (const view of [hq, lq]) {
      expect(view.rarity).toBe(expectedRarity(view.quality));
      expect(view.name).toMatch(/^原创题·DS·Q\d{1,3}$/);
      expect(view.dominantDim).toBe('DS');
    }
  });

  it('费用锚点：N=3 → 26，实扣一致', async () => {
    const user = await register();
    await makeStudent(user.userId, 50);
    await makeStudent(user.userId, 50);
    const author = await makeStudent(user.userId, 50);
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).money;
    const res = await request(app)
      .post('/api/problem-library')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: author.id, dimension: 'MATH' });
    expect(res.status).toBe(200);
    // round(20×(1+0.15×2)) = 26（library.ts 硬编码公式）
    expect(unwrapOk<ProblemView>(res).cost).toBe(26);
    expect(before - (await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).money).toBe(26);
  });

  it('容量 120：121 → STATE_CONFLICT', async () => {
    const user = await register();
    const author = await makeStudent(user.userId, 50);
    await prisma.problemLibraryEntry.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        userId: user.userId,
        authorStudentId: author.id,
        name: `存量题 ${i}`,
        dominantDim: 'DS',
        rarity: 'gray',
        quality: 10,
      })),
    });
    const res = await request(app)
      .post('/api/problem-library')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: author.id, dimension: 'DS' });
    expect(res.status).toBe(409);
    expect(unwrapErr(res).code).toBe('STATE_CONFLICT');
  });

  it('删除已消耗 → 409；无效维度/无钱/无体力 → 400/409', async () => {
    const user = await register();
    const author = await makeStudent(user.userId, 50);
    const auth = { Authorization: `Bearer ${user.token}` };
    const consumed = await prisma.problemLibraryEntry.create({
      data: { userId: user.userId, authorStudentId: author.id, name: '已耗题', dominantDim: 'DS', rarity: 'gray', quality: 10, consumedAt: new Date() },
    });
    const del = await request(app).delete(`/api/problem-library/${consumed.id}`).set(auth);
    expect(del.status).toBe(409);
    expect(unwrapErr(del).code).toBe('STATE_CONFLICT');

    const badDim = await request(app).post('/api/problem-library').set(auth).send({ studentId: author.id, dimension: 'XX' });
    expect(badDim.status).toBe(400);

    const broke = await register(0);
    const brokeStudent = await makeStudent(broke.userId, 50);
    const noMoney = await request(app)
      .post('/api/problem-library')
      .set('Authorization', `Bearer ${broke.token}`)
      .send({ studentId: brokeStudent.id, dimension: 'DS' });
    expect(noMoney.status).toBe(409);
    expect(unwrapErr(noMoney).code).toBe('INSUFFICIENT_RESOURCE');

    await prisma.student.update({ where: { id: author.id }, data: { stamina: 0 } });
    const noStamina = await request(app).post('/api/problem-library').set(auth).send({ studentId: author.id, dimension: 'DS' });
    expect(noStamina.status).toBe(409);
  });

  it('特性合法：traitId 为 null 或配置内特性', async () => {
    const user = await register();
    const author = await makeStudent(user.userId, 100);
    const res = await request(app)
      .post('/api/problem-library')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ studentId: author.id, dimension: 'DS' });
    expect(res.status).toBe(200);
    const traitId = unwrapOk<ProblemView>(res).traitId;
    const traits = getConfig()?.problemTraits ?? {};
    expect(traitId === null || traitId in traits).toBe(true);
  });
});
