import type { NextFunction, Request, Response } from 'express';
import type { ApiEnvelope } from '@oinur/shared';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express 错误中间件必须保留 4 参签名
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    const body: ApiEnvelope<never> = {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.httpStatus).json(body);
    return;
  }
  logger.error({ err, requestId: req.requestId }, 'unhandled error');
  res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: '服务器内部错误' } });
}
