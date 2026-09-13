import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 账号覆盖补强（auth-basic/session 覆盖主流程与 refresh/改密/注销/登出）：
 * 注册校验边界、并发重复注册、登录语义、改密后旧凭证失效、登出后 refresh 失效、
 * 注销级联、封禁拦截、me 动态字段、Authorization 头变体。账号域不依赖 CONFIG，用 fixtures。
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

interface Session {
  accessToken: string;
  me: { id: number; username: string };
}

async function register(username?: string, password = 'pw-12345678'): Promise<{ session: Session; cookies: string[] }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: username ?? `authcov-${Date.now().toString(36)}-${seq}`, password });
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie'] as string | string[] | undefined;
  const cookies = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
  return { session: unwrapOk<Session>(res), cookies };
}

describe('auth coverage：注册与登录', () => {
  it('注册校验边界：用户名 2–32、密码 8–72，用户名自动 trim', async () => {
    const short = await request(app).post('/api/auth/register').send({ username: 'a', password: 'pw-12345678' });
    expect(short.status).toBe(400);
    const long = await request(app).post('/api/auth/register').send({ username: 'u'.repeat(33), password: 'pw-12345678' });
    expect(long.status).toBe(400);
    const weak = await request(app).post('/api/auth/register').send({ username: 'authcov-weak', password: 'short7' });
    expect(weak.status).toBe(400);
    const toolong = await request(app).post('/api/auth/register').send({ username: 'authcov-toolong', password: 'p'.repeat(73) });
    expect(toolong.status).toBe(400);
    const missing = await request(app).post('/api/auth/register').send({ username: 'authcov-missing' });
    expect(missing.status).toBe(400);

    seq += 1;
    const trimmed = await request(app)
      .post('/api/auth/register')
      .send({ username: `  tu${seq}  `, password: 'pw-12345678' });
    expect(trimmed.status).toBe(200);
    expect(unwrapOk<Session>(trimmed).me.username).toBe(`tu${seq}`);
  });

  it('并发重复注册 → 恰其一成功、另一 ALREADY_EXISTS', async () => {
    seq += 1;
    const username = `authcov-race-${Date.now().toString(36)}-${seq}`;
    const [a, b] = await Promise.all([
      request(app).post('/api/auth/register').send({ username, password: 'pw-12345678' }),
      request(app).post('/api/auth/register').send({ username, password: 'pw-12345678' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(unwrapErr(loser).code).toBe('ALREADY_EXISTS');
  });

  it('登录：未知用户与错密同码；lastLoginAt 从 null 变为有值', async () => {
    const { session } = await register();
    expect(session.me.username).toEqual(expect.any(String));
    const meBefore = unwrapOk<{ lastLoginAt: string | null }>(
      await request(app).get('/api/users/me').set('Authorization', `Bearer ${session.accessToken}`),
    );
    expect(meBefore.lastLoginAt).toBeNull();

    const unknown = await request(app).post('/api/auth/login').send({ username: 'authcov-ghost-xyz', password: 'pw-12345678' });
    expect(unknown.status).toBe(401);
    expect(unwrapErr(unknown).code).toBe('INVALID_CREDENTIALS');
    const wrong = await request(app).post('/api/auth/login').send({ username: session.me.username, password: 'pw-wrongpass' });
    expect(wrong.status).toBe(401);
    expect(unwrapErr(wrong).code).toBe('INVALID_CREDENTIALS');

    const ok = await request(app).post('/api/auth/login').send({ username: session.me.username, password: 'pw-12345678' });
    expect(ok.status).toBe(200);
    const after = unwrapOk<Session>(ok);
    const meAfter = unwrapOk<{ lastLoginAt: string | null }>(
      await request(app).get('/api/users/me').set('Authorization', `Bearer ${after.accessToken}`),
    );
    expect(meAfter.lastLoginAt).toEqual(expect.any(String));
  });
});

describe('auth coverage：改密/登出/注销/封禁', () => {
  it('改密：新密码校验 + 旧 access 失效 + 新密码可登旧密码作废', async () => {
    const { session } = await register();
    const auth = { Authorization: `Bearer ${session.accessToken}` };
    const weak = await request(app).put('/api/auth/password').set(auth).send({ oldPassword: 'pw-12345678', newPassword: 'short' });
    expect(weak.status).toBe(400);

    const changed = await request(app).put('/api/auth/password').set(auth).send({ oldPassword: 'pw-12345678', newPassword: 'pw-newpass99' });
    expect(changed.status).toBe(200);
    const stale = await request(app).get('/api/users/me').set(auth);
    expect(stale.status).toBe(401);
    expect(unwrapErr(stale).code).toBe('UNAUTHENTICATED');

    const loginNew = await request(app).post('/api/auth/login').send({ username: session.me.username, password: 'pw-newpass99' });
    expect(loginNew.status).toBe(200);
    const loginOld = await request(app).post('/api/auth/login').send({ username: session.me.username, password: 'pw-12345678' });
    expect(loginOld.status).toBe(401);
  });

  it('登出后旧 refresh Cookie 也失效', async () => {
    const { session, cookies } = await register();
    expect(cookies.some((c) => c.startsWith('oinur_rt='))).toBe(true);
    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${session.accessToken}`);
    expect(out.status).toBe(200);
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookies.join('; '));
    expect(refresh.status).toBe(401);
    expect(unwrapErr(refresh).code).toBe('UNAUTHENTICATED');
  });

  it('注销＝物理删除：账号与业务数据级联清空、用户名释放、登录与旧 token 彻底失效', async () => {
    const { session } = await register();
    const student = await prisma.student.create({
      data: {
        userId: session.me.id, name: '待删学员', sex: 'MALE', qualityTier: 'COMMON',
        ds: 10, dp: 10, math: 10, graph: 10, greedy: 10, str: 10, code: 10, thinking: 10, setting: 10,
        focusCap: 20, energyMax: 50, energy: 50, staminaRegen: 10,
      },
    });
    await prisma.userItem.create({ data: { userId: session.me.id, itemId: 'rename-card', quantity: 2 } });
    await request(app).get('/api/academy/pool').set('Authorization', `Bearer ${session.accessToken}`);
    expect(await prisma.recruitPool.findUnique({ where: { userId: session.me.id } })).not.toBeNull();

    const res = await request(app).post('/api/auth/deactivate').set('Authorization', `Bearer ${session.accessToken}`).send({ password: 'pw-12345678' });
    expect(res.status).toBe(200);
    // 硬删：用户行消失，DB 级联清空学员/道具/招募池/声誉日志等全部业务数据
    expect(await prisma.user.findUnique({ where: { id: session.me.id } })).toBeNull();
    expect(await prisma.student.findUnique({ where: { id: student.id } })).toBeNull();
    expect(await prisma.userItem.findMany({ where: { userId: session.me.id } })).toHaveLength(0);
    expect(await prisma.recruitPool.findUnique({ where: { userId: session.me.id } })).toBeNull();
    expect(await prisma.reputationLog.findMany({ where: { userId: session.me.id } })).toHaveLength(0);

    // 旧 access token 立即失效（用户行已不存在，requireAuth 查库返回 null）
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(401);
    // 登录彻底失败（用户名已无人持有）
    const login = await request(app).post('/api/auth/login').send({ username: session.me.username, password: 'pw-12345678' });
    expect(login.status).toBe(401);
    expect(unwrapErr(login).code).toBe('INVALID_CREDENTIALS');

    // username 唯一索引已释放：同名可立即重新注册，且拿到全新 id
    const reuse = await request(app).post('/api/auth/register').send({ username: session.me.username, password: 'pw-12345678' });
    expect(reuse.status).toBe(200);
    expect(unwrapOk<Session>(reuse).me.id).not.toBe(session.me.id);
  });

  it('注销护栏：进行中 PVP 赛事的报名者不可注销，赛事结束后可注销', async () => {
    const { session } = await register();
    const tournament = await prisma.pvpTournament.create({
      data: { name: '护栏赛', size: 8, registerEndsAt: new Date('2099-01-02T00:00:00.000Z'), autoStartAt: new Date('2099-01-03T00:00:00.000Z'), prizes: {}, config: {} },
    });
    await prisma.pvpRegistration.create({
      data: { tournamentId: tournament.id, userId: session.me.id, roster: {} },
    });

    // REGISTERING/RUNNING 期间拒绝注销：PvpMatch 的参赛者 id 是无外键裸 Int，
    // 硬删会让 playPending 抛 STATE_CONFLICT 并回滚整场推进，赛事对所有剩余选手永久 409
    for (const status of ['REGISTERING', 'RUNNING'] as const) {
      await prisma.pvpTournament.update({ where: { id: tournament.id }, data: { status } });
      const blocked = await request(app).post('/api/auth/deactivate').set('Authorization', `Bearer ${session.accessToken}`).send({ password: 'pw-12345678' });
      expect(blocked.status).toBe(409);
      expect(unwrapErr(blocked).code).toBe('STATE_CONFLICT');
      expect(await prisma.user.findUnique({ where: { id: session.me.id } })).not.toBeNull();
    }

    // 赛事 FINISHED 后放行，且报名行随用户级联删除
    await prisma.pvpTournament.update({ where: { id: tournament.id }, data: { status: 'FINISHED' } });
    const ok = await request(app).post('/api/auth/deactivate').set('Authorization', `Bearer ${session.accessToken}`).send({ password: 'pw-12345678' });
    expect(ok.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: session.me.id } })).toBeNull();
    expect(await prisma.pvpRegistration.findMany({ where: { tournamentId: tournament.id } })).toHaveLength(0);
    // 赛事本体与其他选手数据不受影响
    expect(await prisma.pvpTournament.findUnique({ where: { id: tournament.id } })).not.toBeNull();
    // 本文件 beforeEach 只清 users，赛事行会跨用例/跨文件残留 → 显式清理，避免污染 admin/pvp 套件
    await prisma.pvpTournament.delete({ where: { id: tournament.id } });
  });

  it('封禁用户：持旧 token 访问被拒', async () => {
    const { session } = await register();
    await prisma.user.update({ where: { id: session.me.id }, data: { bannedAt: new Date() } });
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${session.accessToken}`);
    expect(res.status).toBe(401);
    expect(unwrapErr(res).code).toBe('UNAUTHENTICATED');
  });
});

describe('auth coverage：me 与鉴权头', () => {
  it('me 动态反映钱/声誉/徽章变化', async () => {
    const { session } = await register();
    await prisma.user.update({ where: { id: session.me.id }, data: { money: 1234, reputation: 56, badges: ['badge-legend'] } });
    const me = unwrapOk<{ money: number; reputation: number; badges: string[] }>(
      await request(app).get('/api/users/me').set('Authorization', `Bearer ${session.accessToken}`),
    );
    expect(me).toMatchObject({ money: 1234, reputation: 56, badges: ['badge-legend'] });
  });

  it('Authorization 头变体 → UNAUTHENTICATED', async () => {
    const missing = await request(app).get('/api/users/me');
    expect(missing.status).toBe(401);
    const noScheme = await request(app).get('/api/users/me').set('Authorization', 'xxx');
    expect(noScheme.status).toBe(401);
    const wrongScheme = await request(app).get('/api/users/me').set('Authorization', 'Token abc.def.ghi');
    expect(wrongScheme.status).toBe(401);
    const garbage = await request(app).get('/api/users/me').set('Authorization', 'Bearer not-a-jwt');
    expect(garbage.status).toBe(401);
    expect(unwrapErr(garbage).code).toBe('UNAUTHENTICATED');
  });
});
