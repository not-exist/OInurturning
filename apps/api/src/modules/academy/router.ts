import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';
import * as lecture from './lecture.js';

export const academyRouter = Router();

const RecruitBodySchema = z.object({ tempId: z.string().min(1).max(32) });
const LectureBodySchema = z
  .object({
    studentId: z.number().int().positive(),
    tier: z.enum(['beginner', 'junior', 'senior', 'provincial', 'national']),
    force: z.boolean().optional().default(false),
  })
  .strict();

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

academyRouter.get('/lecture-tiers', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await lecture.getLectureTiers(req.user!.id) });
  } catch (e) { next(e); }
});

academyRouter.post('/lectures', requireAuth, async (req, res, next) => {
  try {
    const parsed = LectureBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({
      ok: true,
      data: await lecture.teachLecture(
        req.user!.id,
        parsed.data.studentId,
        parsed.data.tier,
        parsed.data.force,
      ),
    });
  } catch (e) { next(e); }
});

academyRouter.get('/lectures', requireAuth, async (req, res, next) => {
  try {
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ApiError('VALIDATION_FAILED', { field: 'limit' });
    }
    res.json({ ok: true, data: await lecture.listLectureLogs(req.user!.id, limit) });
  } catch (e) { next(e); }
});
