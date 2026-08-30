import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { requestId } from './middlewares/requestId.js';
import { errorHandler } from './middlewares/errorHandler.js';
import type { ApiEnvelope } from '@oinur/shared';

export function createApp(): express.Express {
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
