import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as service from './service.js';

const ngLevelSchema = z.coerce.number().int().nonnegative();
const enterSchema = z
  .object({
    roster: z.array(z.number().int().positive()).length(1),
    ngLevel: ngLevelSchema.default(0),
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .strict();

export const storyRouter = Router();

storyRouter.get('/overview', requireAuth, async (req, res, next) => {
  try {
    const parsed = ngLevelSchema.safeParse(req.query.ngLevel ?? 0);
    if (!parsed.success)
      throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await service.getStoryOverview(req.user!.id, parsed.data) });
  } catch (error) {
    next(error);
  }
});

storyRouter.get('/progress', requireAuth, async (req, res, next) => {
  try {
    const raw = req.query.ngLevel;
    const parsed =
      raw === undefined
        ? { success: true as const, data: undefined }
        : ngLevelSchema.safeParse(raw);
    if (!parsed.success)
      throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await service.getProgress(req.user!.id, parsed.data) });
  } catch (error) {
    next(error);
  }
});

storyRouter.post('/stages/:stageKey/enter', requireAuth, async (req, res, next) => {
  try {
    const parsed = enterSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    const idempotencyKey = req.header('Idempotency-Key') ?? parsed.data.idempotencyKey;
    if (idempotencyKey === undefined)
      throw new ApiError('VALIDATION_FAILED', { field: 'idempotencyKey' });
    res.json({
      ok: true,
      data: await service.enterStoryStage(
        req.user!.id,
        String(req.params.stageKey),
        parsed.data.ngLevel,
        parsed.data.roster,
        idempotencyKey,
      ),
    });
  } catch (error) {
    next(error);
  }
});

export const recordRouter = Router();
recordRouter.get('/:recordId', requireAuth, async (req, res, next) => {
  try {
    res.json({
      ok: true,
      data: await service.getContestRecord(req.user!.id, String(req.params.recordId)),
    });
  } catch (error) {
    next(error);
  }
});
