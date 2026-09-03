import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAdmin } from '../../middlewares/requireAdmin.js';
import * as service from './service.js';

const tournamentSchema = z
  .object({
    name: z.string().min(1).max(64),
    size: z.union([z.literal(8), z.literal(16), z.literal(32)]),
    registerEndsAt: z.coerce.date(),
    autoStartAt: z.coerce.date(),
    prizes: z.record(z.unknown()).default({}),
    config: z.record(z.unknown()).default({}),
  })
  .strict();

const announcementSchema = z
  .object({
    title: z.string().min(1).max(128),
    body: z.string().min(1).max(20_000),
  })
  .strict();

function limitOf(raw: unknown, max: number): number {
  const limit = raw === undefined ? max : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new ApiError('VALIDATION_FAILED', { field: 'limit' });
  }
  return limit;
}

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.post('/tournaments', async (req, res, next) => {
  try {
    const parsed = tournamentSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    if (parsed.data.registerEndsAt <= new Date() || parsed.data.autoStartAt < parsed.data.registerEndsAt) {
      throw new ApiError('VALIDATION_FAILED', { field: 'autoStartAt', reason: 'invalid tournament window' });
    }
    res.json({ ok: true, data: await service.createTournament(req.user!.id, parsed.data) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/tournaments', async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await service.listTournaments() });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/announcements', async (req, res, next) => {
  try {
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await service.createAnnouncement(req.user!.id, parsed.data.title, parsed.data.body) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/announcements', async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.listAnnouncements(limitOf(req.query.limit, 50)) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/users', async (req, res, next) => {
  try {
    const query = req.query.query;
    if (query !== undefined && typeof query !== 'string') throw new ApiError('VALIDATION_FAILED', { field: 'query' });
    res.json({ ok: true, data: await service.searchUsers(query, limitOf(req.query.limit, 100)) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/audits', async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.listAudits(limitOf(req.query.limit, 100)) });
  } catch (error) {
    next(error);
  }
});
