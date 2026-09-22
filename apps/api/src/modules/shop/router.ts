import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';
import { requireTutorialForApi } from '../tutorial/guard.js';

export const shopRouter = Router();

shopRouter.use(requireAuth);
shopRouter.use(requireTutorialForApi);

shopRouter.get('/catalog', async (req, res, next) => {
  try {
    const data = await svc.getCatalog(req.user!.id);
    res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
});

const BuySchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).optional().default(1),
});

shopRouter.post('/buy', async (req, res, next) => {
  try {
    const parsed = BuySchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    const result = await svc.buyItem(req.user!.id, parsed.data.itemId, parsed.data.quantity);
    res.json({ ok: true, data: result });
  } catch (e) {
    next(e);
  }
});

shopRouter.get('/logs', async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const data = await svc.listLogs(req.user!.id, limit);
    res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
});
