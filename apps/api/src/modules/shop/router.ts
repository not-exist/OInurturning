import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';
import { autoAdvanceIfNeeded } from '../tutorial/service.js';

export const shopRouter = Router();

// 教程锁由 app 级 requireTutorialForApi（index.ts）统一覆盖，路由内不再重复挂载
shopRouter.use(requireAuth);

shopRouter.get('/catalog', async (req, res, next) => {
  try {
    // visit_shop 只在本端点推进（getCatalog 无其他调用方）；先推进再读目录，
    // 离开步骤的奖励入账后，目录内的金币/声誉快照才是最新的
    void autoAdvanceIfNeeded(req.user!.id, 'visit_shop');
    const data = await svc.getCatalog(req.user!.id);
    res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
});

const BuySchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
});

shopRouter.post('/buy', async (req, res, next) => {
  try {
    const parsed = BuySchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    const { itemId, quantity } = parsed.data;
    // 幂等键可选（TECH-DESIGN §12 T8）：重复下单/超时重试会重复扣钱，故带了 key 就按 key+请求指纹重放。
    const rawKey = req.header('Idempotency-Key');
    if (rawKey !== undefined && (rawKey.length < 1 || rawKey.length > 128)) {
      throw new ApiError('VALIDATION_FAILED', { field: 'Idempotency-Key' });
    }
    const idempotencyKey =
      rawKey === undefined
        ? undefined
        : // 指纹必须包含操作参数：同一个 key 换了 itemId/数量应视为另一个操作，不能重放
          `shop:buy:${req.user!.id}:${rawKey}:${itemId}:${quantity}`;
    const result = await runIdempotent(idempotencyKey, () => svc.buyItem(req.user!.id, itemId, quantity));
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
