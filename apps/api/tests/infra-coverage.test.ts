import path from 'node:path';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { env } from '../src/config/env.js';
import { importConfigs } from '../src/config/loader.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * 基础设施覆盖：请求追踪、过期 token、统一信封形状、安全头。
 * 不依赖业务 CONFIG，用 fixtures。
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

describe('infra coverage', () => {
  it('X-Request-Id：每次响应携带且唯一', async () => {
    const a = await request(app).get('/api/health');
    const b = await request(app).get('/api/health');
    const idA = a.headers['x-request-id'] as string | undefined;
    const idB = b.headers['x-request-id'] as string | undefined;
    expect(idA).toEqual(expect.any(String));
    expect(idB).toEqual(expect.any(String));
    expect(idA).not.toBe(idB);
  });

  it('过期 access token → TOKEN_EXPIRED（401）', async () => {
    seq += 1;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: `infracov-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
    expect(res.status).toBe(200);
    const session = unwrapOk<{ me: { id: number } }>(res);
    const expired = jwt.sign(
      { uid: session.me.id, role: 'USER', tv: 0, typ: 'access', exp: Math.floor(Date.now() / 1000) - 60 },
      env.JWT_SECRET,
    );
    const denied = await request(app).get('/api/users/me').set('Authorization', `Bearer ${expired}`);
    expect(denied.status).toBe(401);
    expect(unwrapErr(denied).code).toBe('TOKEN_EXPIRED');
  });

  it('错误信封形状：{ok:false,error:{code,message,details}}', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.message).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toBeDefined();
  });

  it('helmet：x-powered-by 缺席，成功信封为 JSON', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-type'] as string).toContain('application/json');
    expect(res.body.ok).toBe(true);
  });
});
