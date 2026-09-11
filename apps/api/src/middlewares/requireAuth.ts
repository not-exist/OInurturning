import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { verifyAccess } from '../lib/jwt.js';
import { ApiError } from '../lib/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: number; role: 'USER' | 'ADMIN'; tokenVersion: number };
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  void (async (): Promise<void> => {
    try {
      const h = req.headers.authorization;
      if (!h?.startsWith('Bearer ')) throw new ApiError('UNAUTHENTICATED');
      let claims: ReturnType<typeof verifyAccess>;
      try {
        claims = verifyAccess(h.slice(7));
      } catch (e) {
        if (e instanceof jwt.TokenExpiredError) throw new ApiError('TOKEN_EXPIRED');
        throw new ApiError('UNAUTHENTICATED');
      }
      const user = await prisma.user.findUnique({
        where: { id: claims.uid },
        select: { id: true, role: true, tokenVersion: true, bannedAt: true, deletedAt: true },
      });
      if (!user || user.bannedAt || user.deletedAt || user.tokenVersion !== claims.tv) throw new ApiError('UNAUTHENTICATED');
      req.user = { id: user.id, role: user.role, tokenVersion: user.tokenVersion };
      next();
    } catch (e) { next(e); }
  })();
}
