import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import { get, unwrap } from './helpers.js';

const app = createApp();

describe('GET /api/health', () => {
  it('返回统一信封的成功数据', async () => {
    const res = await get(app, '/api/health');
    expect(res.status).toBe(200);
    const body = unwrap<{ uptime: number; serverTime: string }>(res);
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof body.data.uptime).toBe('number');
  });
});
