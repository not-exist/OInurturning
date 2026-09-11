import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 管理端覆盖补强（admin.test.ts 仅 4 用例：建赛/公告/尺寸校验/奖池冻结）：
 * 鉴权矩阵、锦标赛参数校验、公告校验与列表、用户查询、审计查询、一键开赛空转。
 * fixtures 即可（奖池用 money-only 或 {}，未知道具断言对任意配置成立）。
 */
const app: Express = createApp();
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/config');
let seq = 0;

beforeAll(async () => {
  await importConfigs({ configDir: FIXTURES });
});
beforeEach(async () => {
  await prisma.pvpTournament.deleteMany({});
  await resetUsers();
});
afterAll(async () => {
  await importConfigs({ configDir: FIXTURES });
});

async function register(username?: string): Promise<{ token: string; userId: number }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: username ?? `admcov-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { token: session.accessToken, userId: session.me.id };
}

async function registerAdmin(): Promise<{ token: string; userId: number }> {
  const admin = await register();
  await prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
  return admin;
}

function futureWindow(): { registerEndsAt: string; autoStartAt: string } {
  return {
    registerEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
    autoStartAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  };
}

describe('admin coverage：鉴权矩阵', () => {
  it('普通用户访问全部管理端点 → 403；无 token → 401', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.token}` };
    const window = futureWindow();
    const calls = [
      request(app).post('/api/admin/tournaments').set(auth).send({ name: 'x', size: 8, ...window }),
      request(app).get('/api/admin/tournaments').set(auth),
      request(app).patch('/api/admin/pvp-tournaments/1').set(auth).send({ prizes: {} }),
      request(app).post('/api/admin/announcements').set(auth).send({ title: 't', body: 'b' }),
      request(app).get('/api/admin/announcements').set(auth),
      request(app).get('/api/admin/users').set(auth),
      request(app).get('/api/admin/audits').set(auth),
      request(app).post('/api/admin/pvp-tournaments/1/actions/start').set(auth),
    ];
    for (const call of calls) {
      const res = await call;
      expect(res.status).toBe(403);
      expect(unwrapErr(res).code).toBe('FORBIDDEN');
    }
    const naked = await request(app).get('/api/admin/tournaments');
    expect(naked.status).toBe(401);
    expect(unwrapErr(naked).code).toBe('UNAUTHENTICATED');
  });
});

describe('admin coverage：锦标赛', () => {
  it('创建成功回显 + 审计快照落盘', async () => {
    const admin = await registerAdmin();
    const res = await request(app)
      .post('/api/admin/tournaments')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: '覆盖杯', size: 16, prizes: { champion: { money: 100 } }, config: {}, ...futureWindow() });
    expect(res.status).toBe(200);
    const created = unwrapOk<{ id: number; name: string; status: string; size: number; createdBy: number }>(res);
    expect(created).toMatchObject({ name: '覆盖杯', status: 'REGISTERING', size: 16, createdBy: admin.userId });

    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'TOURNAMENT_CREATE', targetId: String(created.id) } });
    expect(audit.adminId).toBe(admin.userId);
    expect(audit.targetType).toBe('PVP_TOURNAMENT');
    expect(audit.targetId).toBe(String(created.id));
    expect(audit.payload as object).toMatchObject({ name: '覆盖杯', size: 16 });

    const list = await request(app).get('/api/admin/tournaments').set('Authorization', `Bearer ${admin.token}`);
    expect(unwrapOk<Array<{ id: number }>>(list).map((t) => t.id)).toContain(created.id);
  });

  it('参数校验：尺寸/时间窗/奖池非法 → VALIDATION_FAILED', async () => {
    const admin = await registerAdmin();
    const auth = { Authorization: `Bearer ${admin.token}` };
    const window = futureWindow();

    const badSize = await request(app).post('/api/admin/tournaments').set(auth).send({ name: 'x', size: 4, ...window });
    expect(badSize.status).toBe(400);
    const pastEnd = await request(app)
      .post('/api/admin/tournaments').set(auth)
      .send({ name: 'x', size: 8, registerEndsAt: new Date(Date.now() - 1000).toISOString(), autoStartAt: window.autoStartAt });
    expect(pastEnd.status).toBe(400);
    const badOrder = await request(app)
      .post('/api/admin/tournaments').set(auth)
      .send({ name: 'x', size: 8, registerEndsAt: window.autoStartAt, autoStartAt: window.registerEndsAt });
    expect(badOrder.status).toBe(400);
    const noName = await request(app).post('/api/admin/tournaments').set(auth).send({ size: 8, ...window });
    expect(noName.status).toBe(400);
    const unknownItem = await request(app)
      .post('/api/admin/tournaments').set(auth)
      .send({ name: 'x', size: 8, prizes: { champion: { items: [{ itemId: 'no-such-item', count: 1 }] } }, ...window });
    expect(unknownItem.status).toBe(400);
    expect(unwrapErr(unknownItem).code).toBe('VALIDATION_FAILED');
    const negativeMoney = await request(app)
      .post('/api/admin/tournaments').set(auth)
      .send({ name: 'x', size: 8, prizes: { champion: { money: -5 } }, ...window });
    expect(negativeMoney.status).toBe(400);
  });

  it('奖池更新：截止后冻结、未知赛事 404', async () => {
    const admin = await registerAdmin();
    const auth = { Authorization: `Bearer ${admin.token}` };
    const created = unwrapOk<{ id: number }>(
      await request(app).post('/api/admin/tournaments').set(auth).send({ name: '冻奖杯', size: 8, ...futureWindow() }),
    );
    const updated = await request(app)
      .patch(`/api/admin/pvp-tournaments/${created.id}`)
      .set(auth)
      .send({ prizes: { champion: { money: 3000 } } });
    expect(updated.status).toBe(200);
    expect(unwrapOk<{ prizes: unknown }>(updated).prizes).toEqual({ champion: { money: 3000 } });

    await prisma.pvpTournament.update({ where: { id: created.id }, data: { registerEndsAt: new Date(Date.now() - 1000) } });
    const frozen = await request(app).patch(`/api/admin/pvp-tournaments/${created.id}`).set(auth).send({ prizes: {} });
    expect(frozen.status).toBe(409);
    expect(unwrapErr(frozen).code).toBe('STATE_CONFLICT');

    const missing = await request(app).patch('/api/admin/pvp-tournaments/999999').set(auth).send({ prizes: {} });
    expect(missing.status).toBe(404);
    const badId = await request(app).patch('/api/admin/pvp-tournaments/0').set(auth).send({ prizes: {} });
    expect(badId.status).toBe(404);
  });

  it('一键开赛：autoStartAt 未到 → 空转 REGISTERING 但记审计', async () => {
    const admin = await registerAdmin();
    const auth = { Authorization: `Bearer ${admin.token}` };
    const created = unwrapOk<{ id: number }>(
      await request(app).post('/api/admin/tournaments').set(auth).send({ name: '未到杯', size: 8, ...futureWindow() }),
    );
    const res = await request(app).post(`/api/admin/pvp-tournaments/${created.id}/actions/start`).set(auth);
    expect(res.status).toBe(200);
    expect(unwrapOk<{ status: string }>(res).status).toBe('REGISTERING');
    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'PVP_TOURNAMENT_START', targetId: String(created.id) } });
    expect(audit.payload as object).toMatchObject({ status: 'REGISTERING' });
  });
});

describe('admin coverage：公告/用户/审计', () => {
  it('公告：创建/列表/校验', async () => {
    const admin = await registerAdmin();
    const auth = { Authorization: `Bearer ${admin.token}` };
    const created = unwrapOk<{ id: number; title: string; authorId: number }>(
      await request(app).post('/api/admin/announcements').set(auth).send({ title: '开赛通知', body: '周五开赛' }),
    );
    expect(created.title).toBe('开赛通知');
    expect(created.authorId).toBe(admin.userId);
    const list = unwrapOk<Array<{ id: number; title: string }>>(
      await request(app).get('/api/admin/announcements').set(auth),
    );
    expect(list.map((a) => a.id)).toContain(created.id);

    const emptyTitle = await request(app).post('/api/admin/announcements').set(auth).send({ title: '', body: 'b' });
    expect(emptyTitle.status).toBe(400);
    const longBody = await request(app).post('/api/admin/announcements').set(auth).send({ title: 't', body: 'x'.repeat(20001) });
    expect(longBody.status).toBe(400);
    const badLimit = await request(app).get('/api/admin/announcements?limit=0').set(auth);
    expect(badLimit.status).toBe(400);
    const overLimit = await request(app).get('/api/admin/announcements?limit=51').set(auth);
    expect(overLimit.status).toBe(400);
  });

  it('用户查询：关键字过滤/上限校验', async () => {
    const admin = await registerAdmin();
    await register('alice-adminsearch');
    await register('bob-adminsearch');
    const auth = { Authorization: `Bearer ${admin.token}` };

    const filtered = unwrapOk<Array<{ username: string }>>(
      await request(app).get('/api/admin/users?query=alice-adminsearch').set(auth),
    );
    expect(filtered.map((u) => u.username)).toContain('alice-adminsearch');
    expect(filtered.map((u) => u.username)).not.toContain('bob-adminsearch');

    const all = unwrapOk<Array<{ username: string }>>(await request(app).get('/api/admin/users').set(auth));
    expect(all.length).toBeGreaterThanOrEqual(3);

    const badLimit = await request(app).get('/api/admin/users?limit=101').set(auth);
    expect(badLimit.status).toBe(400);
    // express 默认 simple 解析器下 query[]=x 不会产出数组，用重复键构造非 string query
    const badQuery = await request(app).get('/api/admin/users?query=a&query=b').set(auth);
    expect(badQuery.status).toBe(400);
  });

  it('审计列表：含建赛/公告记录，上限校验', async () => {
    const admin = await registerAdmin();
    const auth = { Authorization: `Bearer ${admin.token}` };
    await request(app).post('/api/admin/tournaments').set(auth).send({ name: '审计杯', size: 8, ...futureWindow() });
    await request(app).post('/api/admin/announcements').set(auth).send({ title: 't', body: 'b' });

    const audits = unwrapOk<Array<{ action: string; adminId: number; adminNameSnapshot: string }>>(
      await request(app).get('/api/admin/audits').set(auth),
    );
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('TOURNAMENT_CREATE');
    expect(actions).toContain('ANNOUNCEMENT_CREATE');
    expect(audits[0]?.adminId).toBe(admin.userId);
    expect(audits[0]?.adminNameSnapshot).toEqual(expect.any(String));

    const badLimit = await request(app).get('/api/admin/audits?limit=0').set(auth);
    expect(badLimit.status).toBe(400);
  });
});

describe('admin coverage：封禁/解封', () => {
  it('封禁即时拦截 + 审计落盘；解封恢复访问', async () => {
    const admin = await registerAdmin();
    const victim = await register();
    const auth = { Authorization: `Bearer ${admin.token}` };

    const ban = await request(app).post(`/api/admin/users/${victim.userId}/ban`).set(auth);
    expect(ban.status).toBe(200);
    const banned = unwrapOk<{ bannedAt: string | null }>(ban);
    expect(banned.bannedAt).toEqual(expect.any(String));

    // 封禁即时生效：旧 token 访问被拒
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${victim.token}`);
    expect(me.status).toBe(401);
    expect(unwrapErr(me).code).toBe('UNAUTHENTICATED');

    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'USER_BAN', targetId: String(victim.userId) } });
    expect(audit.adminId).toBe(admin.userId);
    expect(audit.targetType).toBe('USER');

    const unban = await request(app).post(`/api/admin/users/${victim.userId}/unban`).set(auth);
    expect(unban.status).toBe(200);
    expect(unwrapOk<{ bannedAt: string | null }>(unban).bannedAt).toBeNull();

    const meAfter = await request(app).get('/api/users/me').set('Authorization', `Bearer ${victim.token}`);
    expect(meAfter.status).toBe(200);
  });

  it('保护性约束：不可封禁 ADMIN、未知用户 404、越权参数 404', async () => {
    const admin = await registerAdmin();
    const otherAdmin = await registerAdmin();
    const auth = { Authorization: `Bearer ${admin.token}` };

    const banAdmin = await request(app).post(`/api/admin/users/${otherAdmin.userId}/ban`).set(auth);
    expect(banAdmin.status).toBe(403);
    expect(unwrapErr(banAdmin).code).toBe('FORBIDDEN');

    const selfBan = await request(app).post(`/api/admin/users/${admin.userId}/ban`).set(auth);
    expect(selfBan.status).toBe(403);

    const missing = await request(app).post('/api/admin/users/999999/ban').set(auth);
    expect(missing.status).toBe(404);

    const badId = await request(app).post('/api/admin/users/0/ban').set(auth);
    expect(badId.status).toBe(404);
  });
});
