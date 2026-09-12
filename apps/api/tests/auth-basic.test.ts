import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';
import type { MeView } from '@oinur/shared';

const app = createApp();
const U = { username: 'coach01', password: 'password123' };

beforeEach(resetUsers);

describe('POST /api/auth/register', () => {
  it('注册成功：返回 accessToken 与 MeView，并种下刷新 Cookie', async () => {
    const res = await request(app).post('/api/auth/register').send(U);
    expect(res.status).toBe(200);
    const data = unwrapOk<{ accessToken: string; me: MeView }>(res);
    expect(data.accessToken.split('.')).toHaveLength(3);
    expect(data.me.username).toBe(U.username);
    expect(data.me.money).toBe(1000); // 开局包（docs/data 口径）
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c: string) => c.startsWith('oinur_rt='));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/auth');
  });

  it('重复用户名 → ALREADY_EXISTS', async () => {
    await request(app).post('/api/auth/register').send(U);
    const res = await request(app).post('/api/auth/register').send(U);
    expect(res.status).toBe(409);
    expect(unwrapErr(res).code).toBe('ALREADY_EXISTS');
  });

  it.each([
    ['短密码', 'ab1'],
    ['超长密码', 'x'.repeat(73)],
    ['空用户名', ''],
  ])('非法输入 %s → VALIDATION_FAILED', async (_n, bad) => {
    const res = await request(app).post('/api/auth/register').send({ username: bad, password: bad });
    expect([400, 409]).toContain(res.status);
    expect(unwrapErr(res).code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/auth/login', () => {
  it('正确凭据 → accessToken + lastLoginAt 更新', async () => {
    await request(app).post('/api/auth/register').send(U);
    const res = await request(app).post('/api/auth/login').send(U);
    const data = unwrapOk<{ accessToken: string; me: MeView }>(res);
    expect(data.me.lastLoginAt).not.toBeNull();
  });

  it('密码错误 → 401 INVALID_CREDENTIALS（与用户不存在同码）', async () => {
    await request(app).post('/api/auth/register').send(U);
    const wrongPw = await request(app).post('/api/auth/login').send({ ...U, password: 'wrong-pass-1' });
    const noUser = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'wrong-pass-1' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(unwrapErr(wrongPw).code).toBe('INVALID_CREDENTIALS');
    expect(unwrapErr(noUser).code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /api/users/me', () => {
  it('带有效 token → MeView；无 token → UNAUTHENTICATED', async () => {
    const reg = await request(app).post('/api/auth/register').send(U);
    const token = unwrapOk<{ accessToken: string }>(reg).accessToken;
    const ok = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(unwrapOk<MeView>(ok).role).toBe('USER');
    const anon = await request(app).get('/api/users/me');
    expect(anon.status).toBe(401);
    expect(unwrapErr(anon).code).toBe('UNAUTHENTICATED');
  });
});
