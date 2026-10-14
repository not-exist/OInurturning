import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';

export const talentsRouter = Router();

talentsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await svc.listTalents() });
  } catch (e) { next(e); }
});
