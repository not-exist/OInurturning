import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';

export const overviewRouter = Router();

overviewRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await svc.getOverview(req.user!.id) });
  } catch (e) { next(e); }
});

overviewRouter.post('/checklist/claim', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await svc.claimChecklistReward(req.user!.id) });
  } catch (e) { next(e); }
});
