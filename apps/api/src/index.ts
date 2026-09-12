import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { requestId } from './middlewares/requestId.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { ApiError } from './lib/errors.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { getConfig, importConfigs } from './config/loader.js';
import { academyRouter } from './modules/academy/router.js';
import { authRouter } from './modules/auth/router.js';
import { itemsRouter } from './modules/items/router.js';
import { problemsRouter } from './modules/problems/router.js';
import { problemLibraryRouter } from './modules/problems/library-router.js';
import { studentsRouter } from './modules/students/router.js';
import { talentsRouter } from './modules/talents/router.js';
import { trainingRouter } from './modules/training/router.js';
import { usersRouter } from './modules/users/router.js';
import { recordRouter, storyRouter } from './modules/story/router.js';
import { adventureRouter } from './modules/adventure/router.js';
import { adminRouter } from './modules/admin/router.js';
import { pvpRouter } from './modules/pvp/router.js';
import { overviewRouter } from './modules/overview/router.js';
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

  // HTTP 访问日志（T5.4）：方法/路径/状态码/耗时/requestId，不记录请求体与头（天然免 redact）；
  // 测试环境不刷屏。pino-http 不引入，保持最小依赖面（TECH-DESIGN 取舍 P5 一致）。
  if (env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      const startedAt = process.hrtime.bigint();
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        logger.info(
          {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: Math.round(durationMs * 10) / 10,
            requestId: req.requestId,
          },
          'http request',
        );
      });
      next();
    });
  }

  app.get('/api/health', (_req, res) => {
    const body: ApiEnvelope<{ uptime: number; serverTime: string; configVersion: string | null }> =
      {
        ok: true,
        data: {
          uptime: process.uptime(),
          serverTime: new Date().toISOString(),
          configVersion: getConfig()?.sourceHash.slice(0, 12) ?? null,
        },
      };
    res.json(body);
  });

  // 测试环境跳过限流：单进程串行跑完整套件会超过 authLimiter 的 10 次窗口
  const skipRateLimit = opts.skipRateLimit ?? process.env.NODE_ENV === 'test';
  const skip = (): boolean => skipRateLimit;
  // 命中限流时走统一错误信封（RATE_LIMITED），而非框架默认纯文本
  const limitedHandler: express.RequestHandler = (_req, _res, next) =>
    next(new ApiError('RATE_LIMITED'));
  // 限流参数可经 env 调整（T5.4）：RATE_LIMIT_GLOBAL_MAX/AUTH_MAX 及各自窗口，
  // 缺省即基线 300 req/min、auth 10 req/15min
  const authLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
    limit: env.RATE_LIMIT_AUTH_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    handler: limitedHandler,
  });
  const globalLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_GLOBAL_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    handler: limitedHandler,
  });

  app.use(globalLimiter);
  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/academy', academyRouter);
  app.use('/api/students', studentsRouter);
  app.use('/api/items', itemsRouter);
  app.use('/api/problems', problemsRouter);
  app.use('/api/problem-library', problemLibraryRouter);
  app.use('/api/talents', talentsRouter);
  app.use('/api/training', trainingRouter);
  app.use('/api/story', storyRouter);
  app.use('/api/overview', overviewRouter);
  app.use('/api/records', recordRouter);
  app.use('/api/adventures', adventureRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/pvp', pvpRouter);

  app.use(errorHandler);
  return app;
}

export function startServer(): void {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`[api] listening on :${port}`));
}

// 测试环境的默认配置目录：apps/api/tests/fixtures/config
const TEST_CONFIG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../tests/fixtures/config',
);

// 启动即执行配置即数据管线（坏配置快速失败，绝不带病上线）；
// VITEST 门控内同样执行，使用测试 CONFIG_DIR（可被 env.CONFIG_DIR 显式覆盖）
if (process.env.VITEST === 'true') {
  await importConfigs({ configDir: process.env.CONFIG_DIR ?? TEST_CONFIG_DIR });
} else {
  await importConfigs();
  startServer();
}
