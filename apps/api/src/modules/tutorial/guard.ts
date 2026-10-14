import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../lib/errors.js';
import { getSteps } from './service.js';
import { isApiAllowed, unlockedForStep } from './routing.js';

export function requireTutorialForApi(req: Request, _res: Response, next: NextFunction) {
  // 异步检查
  void (async () => {
    try {
      // optionalAuth 已挂载 req.user（含 tutorialStep/tutorialCompleted/role），不再重复查库；
      // 未认证（req.user 为空）直接放行，由下游 requireAuth 返回 401
      const user = req.user;
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
