import { Router } from 'express';
import { z } from 'zod';
import { DIMENSIONS } from '@oinur/shared';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';

export const trainingRouter = Router();

const StudentIdSchema = z.object({ studentId: z.number().int().positive() });

/** 定向：维度用大写键（DIMENSIONS），bookItemId 可选（缺省灰书） */
const DirectedBodySchema = z.object({
  studentId: z.number().int().positive(),
  dim: z.enum(DIMENSIONS),
  bookItemId: z.string().min(1).optional(),
});

const SpecializedBodySchema = z.object({
  studentId: z.number().int().positive(),
  problemId: z.number().int().positive(),
});

const LogsQuerySchema = z.object({
  studentId: z.coerce.number().int().positive().optional(),
  kind: z.enum(['basic', 'directed', 'specialized']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.coerce.number().int().positive().optional(),
});

trainingRouter.get('/logs', requireAuth, async (req, res, next) => {
  try {
    const parsed = LogsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await svc.listTrainingLogs(req.user!.id, parsed.data) });
  } catch (e) { next(e); }
});

trainingRouter.post('/basic', requireAuth, async (req, res, next) => {
  try {
    const parsed = StudentIdSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await svc.basicTrain(req.user!.id, parsed.data.studentId) });
  } catch (e) { next(e); }
});

trainingRouter.post('/directed', requireAuth, async (req, res, next) => {
  try {
    const parsed = DirectedBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await svc.directedTrain(req.user!.id, parsed.data.studentId, parsed.data.dim, parsed.data.bookItemId) });
  } catch (e) { next(e); }
});

trainingRouter.post('/specialized', requireAuth, async (req, res, next) => {
  try {
    const parsed = SpecializedBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await svc.specializedTrain(req.user!.id, parsed.data.studentId, parsed.data.problemId) });
  } catch (e) { next(e); }
});
