import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';

export const shopRouter = Router();

// 教程锁由 app 级 requireTutorialForApi（index.ts）统一覆盖，路由内不再重复挂载
shopRouter.use(requireAuth);

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

const LogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

shopRouter.get('/logs', async (req, res, next) => {
  try {
    const parsed = LogsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    const data = await svc.listLogs(req.user!.id, parsed.data.limit);
    res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
});
