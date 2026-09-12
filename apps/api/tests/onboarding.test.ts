import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { MeView } from '@oinur/shared';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { grantOnboardingPackage } from '../src/modules/onboarding/service.js';
import { resetUsers, unwrapOk } from './helpers.js';

/**
 * 开局包（economy.onboarding 口径；docs/data 与 fixtures 同值）：
 * 注册事务内发放钱/声誉/固定品质学员/道具/招募池，onboardedAt 幂等。
 */
const app: Express = createApp();
let seq = 0;

async function register(): Promise<{ token: string; userId: number; username: string }> {
  seq += 1;
  const username = `ob-${Date.now().toString(36)}-${seq}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { token: session.accessToken, userId: session.me.id, username };
}

describe('onboarding grant', () => {
  beforeEach(resetUsers);

  it('注册即发放：1000 金/10 誉/GOOD+COMMON/黄书×1+奶茶×2/5 人池/onboardedAt', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };

    const me = unwrapOk<MeView>(await request(app).get('/api/users/me').set(auth));
    expect(me.money).toBe(1000);
    expect(me.reputation).toBe(10);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(row.onboardedAt).not.toBeNull();

    const students = await prisma.student.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'asc' },
    });
    expect(students.map((s) => s.qualityTier)).toEqual(['GOOD', 'COMMON']);
    expect(students.every((s) => s.status === 'ACTIVE')).toBe(true);
    const talents = await prisma.studentTalent.findMany({
      where: { studentId: { in: students.map((s) => s.id) } },
    });
    for (const t of talents) expect(t.acquiredVia).toBe('RECRUIT');

    const items = await prisma.userItem.findMany({ where: { userId: user.userId } });
    expect(items.map((i) => `${i.itemId}×${i.quantity}`).sort()).toEqual([
      'book-ds-yellow×1',
      'milk-tea×2',
    ]);

    const pool = unwrapOk<{ candidates: unknown[] }>(
      await request(app).get('/api/academy/pool').set(auth),
    );
    expect(pool.candidates).toHaveLength(5);

    const repLog = await prisma.reputationLog.findFirstOrThrow({
      where: { userId: user.userId, reason: 'ONBOARDING' },
    });
    expect(repLog.delta).toBe(10);
  });

  it('重复发放 → STATE_CONFLICT（onboardedAt 幂等；资产不翻倍）', async () => {
    seq += 1;
    const bare = await prisma.user.create({
      data: { username: `ob-bare-${Date.now().toString(36)}-${seq}` },
    });
    await prisma.$transaction((tx) => grantOnboardingPackage(tx, bare.id));
    await expect(
      prisma.$transaction((tx) => grantOnboardingPackage(tx, bare.id)),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await prisma.student.count({ where: { userId: bare.id } })).toBe(2);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bare.id } })).money).toBe(1000);
  });
});
