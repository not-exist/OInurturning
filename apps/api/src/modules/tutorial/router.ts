import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';

export const tutorialRouter = Router();

tutorialRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const state = await svc.getTutorialState(req.user!.id);
    res.json({ ok: true, data: state });
  } catch (e) {
    next(e);
  }
});

const AdvanceSchema = z.object({
  step: z.number().int().nonnegative(),
});

tutorialRouter.post('/advance', requireAuth, async (req, res, next) => {
  try {
    const parsed = AdvanceSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    // 客户端只能手动推进纯展示步；行为步的推进证据由对应功能服务端提供
    const state = await svc.advanceTutorial(req.user!.id, parsed.data.step, { reason: 'manual' });
    res.json({ ok: true, data: state });
  } catch (e) {
    next(e);
  }
});

tutorialRouter.post('/complete', requireAuth, async (req, res, next) => {
  try {
    const state = await svc.completeTutorial(req.user!.id);
    res.json({ ok: true, data: state });
  } catch (e) {
    next(e);
  }
});

// 仅测试环境可跳过，用于 e2e 加速
tutorialRouter.post('/skip', requireAuth, async (req, res, next) => {
  try {
    const state = await svc.skipTutorialForTest(req.user!.id);
    res.json({ ok: true, data: state });
  } catch (e) {
    next(e);
  }
});
