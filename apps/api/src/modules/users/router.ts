import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { toMeView } from '../auth/service.js';

export const usersRouter = Router();

usersRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!u) throw new ApiError('UNAUTHENTICATED');
    res.json({ ok: true, data: toMeView(u) });
  } catch (e) { next(e); }
});
