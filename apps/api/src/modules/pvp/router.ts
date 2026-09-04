import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as service from './registration.js';
import * as scheduler from './scheduler.js';
import { claimPvpReward, listPvpRewardGrants } from './rewards.js';

const registrationSchema = z
  .object({
    studentId: z.number().int().positive(),
    problemEntryIds: z.array(z.number().int().positive()).max(2).default([]),
  })
  .strict();

function parseId(raw: string | string[]): number {
  const value = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value <= 0) throw new ApiError('NOT_FOUND', { resource: 'tournament' });
  return value;
}

export const pvpRouter = Router();
pvpRouter.use(requireAuth);

pvpRouter.get('/tournaments', async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.listPvpTournaments(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

pvpRouter.get('/tournaments/:id/registration', async (req, res, next) => {
  try {
    const registration = await service.getRegistration(req.user!.id, parseId(req.params.id));
    if (registration === null) throw new ApiError('NOT_FOUND', { resource: 'registration' });
    res.json({ ok: true, data: registration });
  } catch (error) {
    next(error);
  }
});

pvpRouter.get('/tournaments/:id', async (req, res, next) => {
  try {
    res.json({ ok: true, data: await scheduler.getPvpTournamentDetail(req.user!.id, parseId(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

pvpRouter.get('/tournaments/:id/bracket', async (req, res, next) => {
  try {
    res.json({ ok: true, data: await scheduler.getPvpBracket(req.user!.id, parseId(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

pvpRouter.get('/tournaments/:id/rewards', async (req, res, next) => {
  try {
    const tournamentId = parseId(req.params.id);
    await scheduler.getPvpTournamentDetail(req.user!.id, tournamentId);
    res.json({ ok: true, data: await listPvpRewardGrants(req.user!.id, tournamentId) });
  } catch (error) {
    next(error);
  }
});

pvpRouter.post('/tournaments/:id/rewards/claim', async (req, res, next) => {
  try {
    const tournamentId = parseId(req.params.id);
    await scheduler.getPvpTournamentDetail(req.user!.id, tournamentId);
    res.json({ ok: true, data: await claimPvpReward(req.user!.id, tournamentId) });
  } catch (error) {
    next(error);
  }
});

pvpRouter.post('/tournaments/:id/register', async (req, res, next) => {
  try {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({
      ok: true,
      data: await service.registerPvp(
        req.user!.id,
        parseId(req.params.id),
        parsed.data.studentId,
        parsed.data.problemEntryIds,
      ),
    });
  } catch (error) {
    next(error);
  }
});

// Canonical TECH-DESIGN alias; retain /register for M4.2 clients.
pvpRouter.post('/tournaments/:id/registration', async (req, res, next) => {
  try {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', parsed.error.flatten().fieldErrors);
    res.json({ ok: true, data: await service.registerPvp(req.user!.id, parseId(req.params.id), parsed.data.studentId, parsed.data.problemEntryIds) });
  } catch (error) {
    next(error);
  }
});
