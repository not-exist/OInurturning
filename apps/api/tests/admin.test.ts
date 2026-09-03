import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

const app = createApp();
const REGISTER_END = '2099-01-02T00:00:00.000Z';
const AUTO_START = '2099-01-03T00:00:00.000Z';
let sequence = 0;

async function createUser(role: 'USER' | 'ADMIN' = 'USER'): Promise<{ id: number; token: string }> {
  sequence += 1;
  const response = await request(app)
    .post('/api/auth/register')
    .send({ username: `admin-test-${sequence}-${Date.now().toString(36)}`, password: 'pw-123456' });
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(response);
  if (role === 'ADMIN') await prisma.user.update({ where: { id: session.me.id }, data: { role } });
  return { id: session.me.id, token: session.accessToken };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('M4.1 admin tools', () => {
  beforeEach(resetUsers);

  it('rejects every admin endpoint for a regular user', async () => {
    const user = await createUser();
    const headers = auth(user.token);
    const requests = [
      request(app).post('/api/admin/tournaments').set(headers).send({
        name: '禁用赛事', size: 8, registerEndsAt: REGISTER_END, autoStartAt: AUTO_START,
      }),
      request(app).get('/api/admin/tournaments').set(headers),
      request(app).post('/api/admin/announcements').set(headers).send({ title: 'x', body: 'y' }),
      request(app).get('/api/admin/announcements').set(headers),
      request(app).get('/api/admin/users').set(headers),
      request(app).get('/api/admin/audits').set(headers),
    ];
    const responses = await Promise.all(requests);
    expect(responses.map((response) => [response.status, unwrapErr(response).code])).toEqual(
      responses.map(() => [403, 'FORBIDDEN']),
    );
  });

  it('creates tournaments and announcements with immutable audit snapshots', async () => {
    const admin = await createUser('ADMIN');
    const headers = auth(admin.token);
    const tournamentResponse = await request(app)
      .post('/api/admin/tournaments')
      .set(headers)
      .send({
        name: '秋季公开赛',
        size: 16,
        registerEndsAt: REGISTER_END,
        autoStartAt: AUTO_START,
        prizes: { champion: { money: 1000 } },
        config: { qualityScoring: true },
      });
    expect(tournamentResponse.status).toBe(200);
    const tournament = unwrapOk<{ id: number; status: string; size: number }>(tournamentResponse);
    expect(tournament).toMatchObject({ status: 'REGISTERING', size: 16 });

    const announcementResponse = await request(app)
      .post('/api/admin/announcements')
      .set(headers)
      .send({ title: '报名开始', body: '秋季公开赛开放报名。' });
    expect(announcementResponse.status).toBe(200);

    const tournaments = unwrapOk<{ id: number }[]>(await request(app).get('/api/admin/tournaments').set(headers));
    expect(tournaments.map((entry) => entry.id)).toContain(tournament.id);
    const announcements = unwrapOk<{ title: string }[]>(await request(app).get('/api/admin/announcements').set(headers));
    expect(announcements[0]?.title).toBe('报名开始');

    const users = unwrapOk<{ username: string; passwordHash?: string }[]>(
      await request(app).get('/api/admin/users').query({ query: 'admin-test' }).set(headers),
    );
    expect(users.some((user) => user.username.startsWith('admin-test'))).toBe(true);
    expect(users.every((user) => user.passwordHash === undefined)).toBe(true);

    const audits = unwrapOk<{ action: string; adminNameSnapshot: string }[]>(
      await request(app).get('/api/admin/audits').set(headers),
    );
    expect(audits.map((entry) => entry.action)).toEqual(['ANNOUNCEMENT_CREATE', 'TOURNAMENT_CREATE']);
    expect(audits.every((entry) => entry.adminNameSnapshot.startsWith('admin-test'))).toBe(true);
  });

  it('validates tournament size and chronological time window', async () => {
    const admin = await createUser('ADMIN');
    const headers = auth(admin.token);
    const invalidSize = await request(app).post('/api/admin/tournaments').set(headers).send({
      name: '非法赛事', size: 12, registerEndsAt: REGISTER_END, autoStartAt: AUTO_START,
    });
    expect(invalidSize.status).toBe(400);
    const invalidWindow = await request(app).post('/api/admin/tournaments').set(headers).send({
      name: '非法时间', size: 8, registerEndsAt: AUTO_START, autoStartAt: REGISTER_END,
    });
    expect(invalidWindow.status).toBe(400);
  });
});
