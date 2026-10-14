import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors.js';
import { requireAuth } from './requireAuth.js';

/** 管理端统一复用鉴权，再以 token 中经数据库确认的 role 做授权。 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, (error?: unknown) => {
    if (error !== undefined) {
      next(error);
      return;
    }
    if (req.user?.role !== 'ADMIN') {
      next(new ApiError('FORBIDDEN', { resource: 'admin' }));
      return;
    }
    next();
  });
}
