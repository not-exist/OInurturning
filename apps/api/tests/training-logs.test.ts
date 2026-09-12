import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/** 训练记录：落库快照 + 查询过滤/游标 + 越权隔离。 */
const app: Express = createApp();
let seq = 0;

async function register(money = 100000): Promise<{ token: string; userId: number }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `tlog-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  await prisma.user.update({ where: { id: session.me.id }, data: { money } });
  return { token: session.accessToken, userId: session.me.id };
}

async function onboardingStudents(userId: number): Promise<{ id: number; name: string }[]> {
  return prisma.student.findMany({
    where: { userId },
    orderBy: { id: 'asc' },
    select: { id: true, name: true },
  });
}

interface LogItem {
  id: number;
  studentId: number | null;
  studentName: string;
  kind: string;
  dim: string;
  delta: number;
  cost: number;
  staminaAfter: number;
  bookItemId: string | null;
  problemId: number | null;
  createdAt: string;
}

interface LogPage {
  items: LogItem[];
  nextCursor: number | null;
}

describe('training logs', () => {
  beforeEach(resetUsers);

  it('基础训练落库：logId 回传 + 记录字段完整', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };
    const [trainee] = await onboardingStudents(user.userId);

    const trained = await request(app)
      .post('/api/training/basic')
      .set(auth)
      .send({ studentId: trainee!.id });
    expect(trained.status).toBe(200);
    const result = unwrapOk<{ logId: number; dim: string; delta: number; cost: number }>(trained);
    expect(result.logId).toBeGreaterThan(0);

    const page = unwrapOk<LogPage>(
      await request(app).get(`/api/training/logs?studentId=${trainee!.id}`).set(auth),
    );
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      id: result.logId,
      studentId: trainee!.id,
      studentName: trainee!.name,
      kind: 'basic',
      dim: result.dim,
      cost: result.cost,
      bookItemId: null,
      problemId: null,
    });
    // MySQL FLOAT 回读（1.32496）≠ JS double 全精度：delta 近似比对
    expect(page.items[0]!.delta).toBeCloseTo(result.delta, 5);
    expect(page.items[0]!.staminaAfter).toBeCloseTo(4, 2);
    expect(typeof page.items[0]!.createdAt).toBe('string');
  });

  it('定向/专项记录携带 bookItemId/problemId；kind 过滤生效', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };
    const [trainee] = await onboardingStudents(user.userId);
    await prisma.userItem.create({
      data: { userId: user.userId, itemId: 'book-ds-green', quantity: 1 },
    });
    const problem = await prisma.problemLibraryEntry.create({
      data: {
        userId: user.userId,
        name: '快照题',
        dominantDim: 'DS',
        rarity: 'green',
        quality: 60,
      },
    });

    const directed = await request(app)
      .post('/api/training/directed')
      .set(auth)
      .send({ studentId: trainee!.id, dim: 'DS', bookItemId: 'book-ds-green' });
    expect(directed.status).toBe(200);
    const specialized = await request(app)
      .post('/api/training/specialized')
      .set(auth)
      .send({ studentId: trainee!.id, problemId: problem.id });
    expect(specialized.status).toBe(200);

    const dirPage = unwrapOk<LogPage>(
      await request(app).get('/api/training/logs?kind=directed').set(auth),
    );
    expect(dirPage.items).toHaveLength(1);
    expect(dirPage.items[0]).toMatchObject({ kind: 'directed', bookItemId: 'book-ds-green' });

    const specPage = unwrapOk<LogPage>(
      await request(app).get('/api/training/logs?kind=specialized').set(auth),
    );
    expect(specPage.items).toHaveLength(1);
    expect(specPage.items[0]).toMatchObject({ kind: 'specialized', problemId: problem.id });

    const basicPage = unwrapOk<LogPage>(
      await request(app).get('/api/training/logs?kind=basic').set(auth),
    );
    expect(basicPage.items).toEqual([]);
  });

  it('游标翻页：id 倒序 + nextCursor 耗尽为 null', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };
    const [trainee] = await onboardingStudents(user.userId);
    for (let i = 0; i < 3; i += 1) {
      const r = await request(app)
        .post('/api/training/basic')
        .set(auth)
        .send({ studentId: trainee!.id });
      expect(r.status).toBe(200);
    }

    const p1 = unwrapOk<LogPage>(
      await request(app).get(`/api/training/logs?studentId=${trainee!.id}&limit=2`).set(auth),
    );
    expect(p1.items).toHaveLength(2);
    expect(p1.items[0]!.id).toBeGreaterThan(p1.items[1]!.id);
    expect(p1.nextCursor).toBe(p1.items[1]!.id);

    const p2 = unwrapOk<LogPage>(
      await request(app)
        .get(`/api/training/logs?studentId=${trainee!.id}&limit=2&cursor=${p1.nextCursor}`)
        .set(auth),
    );
    expect(p2.items).toHaveLength(1);
    expect(p2.items[0]!.id).toBeLessThan(p1.nextCursor!);
    expect(p2.nextCursor).toBeNull();
  });

  it('非法参数 → 400 VALIDATION_FAILED', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };
    for (const query of ['cursor=abc', 'kind=nope', 'limit=0', 'studentId=-1']) {
      const res = await request(app).get(`/api/training/logs?${query}`).set(auth);
      expect(res.status).toBe(400);
      expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
    }
  });

  it('学员硬删后记录保留快照（studentId 置空、姓名保留）', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };
    const [trainee] = await onboardingStudents(user.userId);
    const trained = await request(app)
      .post('/api/training/basic')
      .set(auth)
      .send({ studentId: trainee!.id });
    expect(trained.status).toBe(200);

    await prisma.student.delete({ where: { id: trainee!.id } });
    const page = unwrapOk<LogPage>(await request(app).get('/api/training/logs').set(auth));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ studentId: null, studentName: trainee!.name });
  });

  it('跨用户隔离：只能查到自己的记录', async () => {
    const a = await register();
    const b = await register();
    const [traineeA] = await onboardingStudents(a.userId);
    const [traineeB] = await onboardingStudents(b.userId);
    await request(app)
      .post('/api/training/basic')
      .set({ Authorization: `Bearer ${a.token}` })
      .send({ studentId: traineeA!.id });
    await request(app)
      .post('/api/training/basic')
      .set({ Authorization: `Bearer ${b.token}` })
      .send({ studentId: traineeB!.id });

    const pageA = unwrapOk<LogPage>(
      await request(app)
        .get('/api/training/logs')
        .set({ Authorization: `Bearer ${a.token}` }),
    );
    expect(pageA.items).toHaveLength(1);
    expect(pageA.items[0]!.studentName).toBe(traineeA!.name);
    // 拿别人的 studentId 过滤 → 空集（不泄露存在性）
    const foreign = unwrapOk<LogPage>(
      await request(app)
        .get(`/api/training/logs?studentId=${traineeB!.id}`)
        .set({ Authorization: `Bearer ${a.token}` }),
    );
    expect(foreign.items).toEqual([]);
  });

  it('未认证 → 401', async () => {
    const res = await request(app).get('/api/training/logs');
    expect(res.status).toBe(401);
  });
});
