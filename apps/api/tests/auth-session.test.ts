import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';
import type { MeView } from '@oinur/shared';

const app = createApp();
const U = { username: 'sess01', password: 'password123' };

beforeEach(resetUsers);

function setCookies(res: request.Response): string[] {
  return res.headers['set-cookie'] as unknown as string[];
}

async function registerAndGetCookies(): Promise<{ token: string; cookies: string[] }> {
  const res = await request(app).post('/api/auth/register').send(U);
  return {
    token: unwrapOk<{ accessToken: string }>(res).accessToken,
    cookies: setCookies(res),
  };
}

describe('POST /api/auth/refresh', () => {
  it('携带刷新 Cookie → 新 accessToken + 新 Cookie（轮换）', async () => {
    const { cookies } = await registerAndGetCookies();
    const rt = cookies.find((c) => c.startsWith('oinur_rt='))!;
    const res = await request(app).post('/api/auth/refresh').set('Cookie', rt.split(';')[0]);
    expect(res.status).toBe(200);
    unwrapOk<{ accessToken: string }>(res);
    expect(setCookies(res).some((c: string) => c.startsWith('oinur_rt='))).toBe(true);
  });

  it('新 accessToken 可用，且刷新 Cookie 不可冒充 access token', async () => {
    const { cookies } = await registerAndGetCookies();
    const rt = cookies.find((c) => c.startsWith('oinur_rt='))!.split(';')[0];
    const res = await request(app).post('/api/auth/refresh').set('Cookie', rt);
    const newAccess = unwrapOk<{ accessToken: string }>(res).accessToken;
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${newAccess}`);
    expect(me.status).toBe(200);

    // refresh token 携带 typ:'refresh'，不得通过 requireAuth 的 access 校验
    const rtValue = rt.slice('oinur_rt='.length);
    const abuse = await request(app).get('/api/users/me').set('Authorization', `Bearer ${rtValue}`);
    expect(abuse.status).toBe(401);
    expect(unwrapErr(abuse).code).toBe('UNAUTHENTICATED');
  });

  it('畸形 Cookie（非法 percent-encoding）→ UNAUTHENTICATED，不得 500', async () => {
    const malformed = await request(app).post('/api/auth/refresh').set('Cookie', 'oinur_rt=%');
    expect(malformed.status).toBe(401);
    expect(unwrapErr(malformed).code).toBe('UNAUTHENTICATED');
    const malformed2 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'oinur_rt=%E0%A4%A');
    expect(malformed2.status).toBe(401);
    expect(unwrapErr(malformed2).code).toBe('UNAUTHENTICATED');
  });

  it('无 Cookie → UNAUTHENTICATED；篡改 Cookie → UNAUTHENTICATED', async () => {
    const none = await request(app).post('/api/auth/refresh');
    expect(none.status).toBe(401);
    expect(unwrapErr(none).code).toBe('UNAUTHENTICATED');
    const tampered = await request(app).post('/api/auth/refresh').set('Cookie', 'oinur_rt=abc.def.ghi');
    expect(tampered.status).toBe(401);
    expect(unwrapErr(tampered).code).toBe('UNAUTHENTICATED');
  });
});

describe('改密后的全局失效', () => {
  it('PUT /api/auth/password 后：旧 access 401、旧 refresh Cookie 也失效', async () => {
    const { token, cookies } = await registerAndGetCookies();
    const rt = cookies.find((c) => c.startsWith('oinur_rt='))!.split(';')[0];

    const changed = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: U.password, newPassword: 'new-password-9' });
    expect(changed.status).toBe(200);

    const oldAccess = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(oldAccess.status).toBe(401);

    const oldRefresh = await request(app).post('/api/auth/refresh').set('Cookie', rt);
    expect(oldRefresh.status).toBe(401);

    const relogin = await request(app).post('/api/auth/login')
      .send({ username: U.username, password: 'new-password-9' });
    expect(relogin.status).toBe(200);
  });

  it('旧密码错误 → INVALID_CREDENTIALS 且 tokenVersion 未变', async () => {
    const { token } = await registerAndGetCookies();
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: 'wrong-old-pass', newPassword: 'new-password-9' });
    expect(res.status).toBe(401);
    expect(unwrapErr(res).code).toBe('INVALID_CREDENTIALS');
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200); // 未失效
  });
});

describe('注销', () => {
  it('POST /api/auth/deactivate：软删账号、token 失效、用户名不可复用', async () => {
    const { token } = await registerAndGetCookies();
    const del = await request(app)
      .post('/api/auth/deactivate')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: U.password });
    expect(del.status).toBe(200);

    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);

    // 软删后用户名保持占用：重新注册同用户名 → ALREADY_EXISTS
    const reuse = await request(app).post('/api/auth/register').send(U);
    expect(reuse.status).toBe(409);
    expect(unwrapErr(reuse).code).toBe('ALREADY_EXISTS');
  });

  it('密码确认不符 → INVALID_CREDENTIALS，账号保留', async () => {
    const { token } = await registerAndGetCookies();
    const res = await request(app)
      .post('/api/auth/deactivate')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'not-my-password' });
    expect(res.status).toBe(401);
    expect(unwrapErr(res).code).toBe('INVALID_CREDENTIALS');
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
  });
});

describe('登出', () => {
  it('POST /api/auth/logout：tokenVersion+1，旧 token 失效，Cookie 清除', async () => {
    const { token, cookies } = await registerAndGetCookies();
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookies.map((c) => c.split(';')[0]));
    expect(logout.status).toBe(200);
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
    expect(setCookies(logout).join()).toContain('Max-Age=0');
  });
});

describe('MeView 字段', () => {
  it('包含 id/username/role/createdAt/lastLoginAt/money/reputation/badges', async () => {
    const { token } = await registerAndGetCookies();
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    const me = unwrapOk<MeView>(res);
    expect(Object.keys(me).sort()).toEqual(
      ['badges', 'createdAt', 'id', 'lastLoginAt', 'money', 'reputation', 'role', 'username'].sort(),
    );
  });
});
