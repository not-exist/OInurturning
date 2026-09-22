import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { getSteps } from './service.js';
import { isApiAllowed, unlockedForStep } from './routing.js';

export function requireTutorialForApi(req: Request, _res: Response, next: NextFunction) {
  // 异步检查
  void (async () => {
    try {
      const userId = req.user?.id;
      if (!userId) return next();
      // 管理员豁免？不，管理员也需要引导，但可配置
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { tutorialStep: true, tutorialCompleted: true, role: true } });
      if (!user) return next();
      if (user.role === 'ADMIN') return next(); // 管理员豁免锁定
      if (user.tutorialCompleted) return next();
      const steps = getSteps();
      const unlocked = unlockedForStep(user.tutorialStep, false, steps);
      const apiPath = req.originalUrl.split('?')[0] ?? '';
      if (isApiAllowed(unlocked, apiPath)) return next();
      // 否则锁定
      return next(new ApiError('FORBIDDEN', { resource: 'tutorial', reason: '功能被锁定，完成新手引导后解锁', requiredStep: user.tutorialStep, apiPath }));
    } catch (e) {
      return next(e);
    }
  })();
}
