import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';

export const itemsRouter = Router();

const UseBodySchema = z.object({
  itemId: z.string().min(1),
  studentId: z.number().int().positive().optional(),
  payload: z.unknown().optional(),
});

itemsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await svc.listItems(req.user!.id) });
  } catch (e) { next(e); }
});

itemsRouter.post('/use', requireAuth, async (req, res, next) => {
  try {
    const parsed = UseBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await svc.useItem(req.user!.id, parsed.data) });
  } catch (e) { next(e); }
});
