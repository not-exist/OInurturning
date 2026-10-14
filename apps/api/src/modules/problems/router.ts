import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';

export const problemsRouter = Router();

problemsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await svc.listProblems(req.user!.id) });
  } catch (e) { next(e); }
});
