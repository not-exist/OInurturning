import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { requestId } from './middlewares/requestId.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { ApiError } from './lib/errors.js';
import { authRouter } from './modules/auth/router.js';
import { usersRouter } from './modules/users/router.js';
import type { ApiEnvelope } from '@oinur/shared';

export interface AppOptions {
  /** 默认在 NODE_ENV=test 时跳过限流；429 专项测试可显式传 false 开启 */
  skipRateLimit?: boolean;
}

export function createApp(opts: AppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  app.use(requestId);

  app.get('/api/health', (_req, res) => {
    const body: ApiEnvelope<{ uptime: number; serverTime: string }> = {
      ok: true,
      data: { uptime: process.uptime(), serverTime: new Date().toISOString() },
    };
    res.json(body);
  });

  // 测试环境跳过限流：单进程串行跑完整套件会超过 authLimiter 的 10 次窗口
  const skipRateLimit = opts.skipRateLimit ?? process.env.NODE_ENV === 'test';
  const skip = (): boolean => skipRateLimit;
  // 命中限流时走统一错误信封（RATE_LIMITED），而非框架默认纯文本
  const limitedHandler: express.RequestHandler = (_req, _res, next) => next(new ApiError('RATE_LIMITED'));
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, skip, handler: limitedHandler,
  });
  const globalLimiter = rateLimit({
    windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false, skip, handler: limitedHandler,
  });

  app.use(globalLimiter);
  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/users', usersRouter);

  app.use(errorHandler);
  return app;
}

export function startServer(): void {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`[api] listening on :${port}`));
}

// 被 tsx watch 直跑时启动；被测试导入时仅暴露 createApp
if (process.env.VITEST !== 'true') {
  void crypto.randomUUID; // 触发 node:crypto 引用完整性（占位，无副作用）
  startServer();
}
