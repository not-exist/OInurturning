import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as svc from './service.js';

export const studentsRouter = Router();

/** 姓名 2–12 字符（student.md §9 改名卡口径） */
const RenameBodySchema = z.object({ name: z.string().min(2).max(12) });

function parseId(raw: string | string[]): number {
  const id = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('NOT_FOUND', { resource: 'student' });
  return id;
}

studentsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await svc.listStudents(req.user!.id) });
  } catch (e) { next(e); }
});

studentsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await svc.getStudent(req.user!.id, parseId(req.params.id!)) });
  } catch (e) { next(e); }
});

studentsRouter.post('/:id/rename', requireAuth, async (req, res, next) => {
  try {
    const parsed = RenameBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await svc.renameStudent(req.user!.id, parseId(req.params.id!), parsed.data.name) });
  } catch (e) { next(e); }
});

studentsRouter.post('/:id/dismiss', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await svc.dismissStudent(req.user!.id, parseId(req.params.id!)) });
  } catch (e) { next(e); }
});
