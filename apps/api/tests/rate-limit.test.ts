import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { unwrapErr } from './helpers.js';

// 专项：限流器在 NODE_ENV=test 下默认 skip，这里显式开启验证 429 信封
const app = createApp({ skipRateLimit: false });

describe('限流', () => {
  it('auth 端点超过窗口阈值 → 429 RATE_LIMITED 信封', async () => {
    // authLimiter: 10 次 / 15min。空 body 走 VALIDATION_FAILED 快路径（不触发 bcrypt），
    // 但限流中间件在路由之前，所有请求均计数。
    let last: request.Response | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).not.toBe(429);
      last = res;
    }
    expect(last).not.toBeNull();
    expect(unwrapErr(last!).code).toBe('VALIDATION_FAILED');

    const over = await request(app).post('/api/auth/login').send({});
    expect(over.status).toBe(429);
    expect(unwrapErr(over).code).toBe('RATE_LIMITED');
  });
});
