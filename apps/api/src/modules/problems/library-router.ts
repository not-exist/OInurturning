import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as service from './library.js';

const createSchema = z
  .object({
    studentId: z.number().int().positive(),
    dimension: z.enum(['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING']),
  })
  .strict();

function parseId(raw: string | string[]): number {
  const value = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value <= 0) throw new ApiError('NOT_FOUND', { resource: 'problem' });
  return value;
}

export const problemLibraryRouter = Router();

problemLibraryRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await service.createProblem(req.user!.id, parsed.data.studentId, parsed.data.dimension) });
  } catch (error) {
    next(error);
  }
});

problemLibraryRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.listProblemLibrary(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

problemLibraryRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await service.deleteProblem(req.user!.id, parseId(req.params.id));
    res.json({ ok: true, data: null });
  } catch (error) {
    next(error);
  }
});
