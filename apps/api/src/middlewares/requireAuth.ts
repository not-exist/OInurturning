import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { verifyAccess } from '../lib/jwt.js';
import { ApiError } from '../lib/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: number;
      role: 'USER' | 'ADMIN';
      tokenVersion: number;
      tutorialStep: number;
      tutorialCompleted: boolean;
    };
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  // 全局 optionalAuth（index.ts）已按同一套校验挂载 req.user 时直接复用，省一次 user-PK 查询
  if (req.user) return next();
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
        select: {
          id: true,
          role: true,
          tokenVersion: true,
          bannedAt: true,
          tutorialStep: true,
          tutorialCompleted: true,
        },
      });
      // 注销账号已物理删除 → findUnique 返回 null，同样落到 UNAUTHENTICATED，无需状态位
      if (!user || user.bannedAt || user.tokenVersion !== claims.tv) throw new ApiError('UNAUTHENTICATED');
      req.user = {
        id: user.id,
        role: user.role,
        tokenVersion: user.tokenVersion,
        tutorialStep: user.tutorialStep,
        tutorialCompleted: user.tutorialCompleted,
      };
      next();
    } catch (e) { next(e); }
  })();
}
