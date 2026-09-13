import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { CredentialsSchema, ChangePasswordSchema } from './schemas.js';
import * as svc from './service.js';
import { verifyRefresh } from '../../lib/jwt.js';

export const authRouter = Router();

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError('VALIDATION_FAILED', r.error.flatten().fieldErrors);
  return r.data;
}

authRouter.post('/register', async (req, res, next) => {
  try {
    const s = await svc.register(parse(CredentialsSchema, req.body));
    res.setHeader('Set-Cookie', svc.refreshCookie(s.refreshToken));
    res.json({ ok: true, data: { accessToken: s.accessToken, me: s.me } });
  } catch (e) { next(e); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const s = await svc.login(parse(CredentialsSchema, req.body));
    res.setHeader('Set-Cookie', svc.refreshCookie(s.refreshToken));
    res.json({ ok: true, data: { accessToken: s.accessToken, me: s.me } });
  } catch (e) { next(e); }
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await svc.bumpTokenVersionAndLogout(req.user!.id);
    res.setHeader('Set-Cookie', svc.clearRefreshCookie());
    res.json({ ok: true, data: null });
  } catch (e) { next(e); }
});

authRouter.put('/password', requireAuth, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = parse(ChangePasswordSchema, req.body);
    await svc.changePassword(req.user!.id, oldPassword, newPassword);
    res.setHeader('Set-Cookie', svc.clearRefreshCookie());
    res.json({ ok: true, data: null }); // tokenVersion+1 → 所有旧 token 失效，前端跳登录
  } catch (e) { next(e); }
});

authRouter.post('/deactivate', requireAuth, async (req, res, next) => {
  try {
    const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash)))
      throw new ApiError('INVALID_CREDENTIALS', { field: 'password' });
    await svc.deactivate(req.user!.id);
    res.setHeader('Set-Cookie', svc.clearRefreshCookie());
    res.json({ ok: true, data: null });
  } catch (e) { next(e); }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const raw = (req.headers.cookie ?? '')
      .split(';').map((c) => c.trim()).find((c) => c.startsWith('oinur_rt='))
      ?.slice('oinur_rt='.length);
    if (!raw) throw new ApiError('UNAUTHENTICATED');
    const claims = verifyRefresh(decodeURIComponent(raw));
    const user = await prisma.user.findUnique({ where: { id: claims.uid } });
    if (!user || !user.passwordHash || user.bannedAt || user.tokenVersion !== claims.tv)
      throw new ApiError('UNAUTHENTICATED');
    const s = svc.sessionFor(user);
    res.setHeader('Set-Cookie', svc.refreshCookie(s.refreshToken));
    res.json({ ok: true, data: { accessToken: s.accessToken, me: s.me } });
  } catch (e) {
    // TokenExpiredError 继承自 JsonWebTokenError，无需单列；
    // URIError 来自畸形 percent-encoding 的 Cookie（decodeURIComponent 抛出），同按未认证处理
    next(e instanceof jwt.JsonWebTokenError || e instanceof URIError ? new ApiError('UNAUTHENTICATED') : e);
  }
});
