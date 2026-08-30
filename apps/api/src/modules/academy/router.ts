import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';

export const academyRouter = Router();

const RecruitBodySchema = z.object({ tempId: z.string().min(1).max(32) });

academyRouter.get('/pool', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await svc.getPool(req.user!.id) });
  } catch (e) { next(e); }
});

academyRouter.post('/refresh', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await svc.refreshPool(req.user!.id) });
  } catch (e) { next(e); }
});

academyRouter.post('/recruit', requireAuth, async (req, res, next) => {
  try {
    const parsed = RecruitBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await svc.recruit(req.user!.id, parsed.data.tempId) });
  } catch (e) { next(e); }
});
