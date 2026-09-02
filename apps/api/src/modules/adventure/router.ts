import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as service from './service.js';

const drawSchema = z
  .object({
    studentId: z.number().int().positive(),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

const choiceSchema = z.union([
  z.object({ action: z.literal('accept') }).strict(),
  z.object({ action: z.literal('avoid') }).strict(),
  z
    .object({
      optionIndex: z.number().int().nonnegative(),
      skill: z.string().min(1).optional(),
    })
    .strict(),
]);

function parseId(raw: string | string[]): number {
  const value = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value <= 0) throw new ApiError('NOT_FOUND', { resource: 'adventure' });
  return value;
}

export const adventureRouter = Router();

adventureRouter.post('/draw', requireAuth, async (req, res, next) => {
  try {
    const parsed = drawSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    const data = await service.drawAdventure(req.user!.id, parsed.data.studentId, parsed.data.tier);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

adventureRouter.post('/:id/choice', requireAuth, async (req, res, next) => {
  try {
    const parsed = choiceSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    const data = await service.chooseAdventure(req.user!.id, parseId(req.params.id), parsed.data);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

adventureRouter.get('/logs', requireAuth, async (req, res, next) => {
  try {
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ApiError('VALIDATION_FAILED', { field: 'limit' });
    }
    res.json({ ok: true, data: await service.listAdventureLogs(req.user!.id, limit) });
  } catch (error) {
    next(error);
  }
});
