import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { request } from '@playwright/test';
import { API_URL, E2E_DATABASE_URL, E2E_JWT_SECRET } from './fixtures';

const execFileAsync = promisify(execFile);

interface AuthEnvelope {
  ok: boolean;
  data?: { accessToken: string; me: { id: number; username: string; role: string } };
  error?: { code?: string; message?: string };
}

/**
 * 全局前置：准备 e2e 管理员账号（幂等，可重复跑）。
 *
 * 1. POST /api/auth/register 建号（ALREADY_EXISTS 视为成功——库在多次运行间复用）；
 * 2. 直接调 set-admin.ts 做 promote（不走 pnpm admin:set 脚本：后者带 --env-file=../../.env，
 *    CI 无 .env 会起不来；这里显式注入 DATABASE_URL/JWT_SECRET）；
 * 3. 登录校验 role=ADMIN，把账号写入 tests/e2e/.auth/admin.json 供各 spec 读取
 *    （globalSetup 与测试 worker 不共享进程内存，只能走文件）。
 */
export default async function globalSetup(): Promise<void> {
  const adminUser = process.env.E2E_ADMIN_USER ?? 'e2e-admin';
  const adminPass = process.env.E2E_ADMIN_PASS ?? 'E2eAdmin1234!';
  const ctx = await request.newContext({ baseURL: API_URL });

  const reg = await ctx.post('/api/auth/register', {
    data: { username: adminUser, password: adminPass },
  });
  if (!reg.ok()) {
    const body = (await reg.json()) as AuthEnvelope;
    if (body?.error?.code !== 'ALREADY_EXISTS') {
      throw new Error(`[global-setup] 注册管理员失败：${reg.status()} ${JSON.stringify(body)}`);
    }
  }

  await execFileAsync(
    'pnpm',
    ['-C', 'apps/api', 'exec', 'tsx', 'src/scripts/set-admin.ts', 'promote', adminUser],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: E2E_DATABASE_URL,
        JWT_SECRET: E2E_JWT_SECRET,
      },
    },
  );

  const login = await ctx.post('/api/auth/login', {
    data: { username: adminUser, password: adminPass },
  });
  if (!login.ok()) throw new Error(`[global-setup] 管理员登录失败：${login.status()}`);
  const body = (await login.json()) as AuthEnvelope;
  if (body?.data?.me?.role !== 'ADMIN') {
    throw new Error(`[global-setup] 管理员提权未生效：${JSON.stringify(body?.data?.me)}`);
  }
  await ctx.dispose();

  const authDir = path.resolve(process.cwd(), 'tests/e2e/.auth');
  await mkdir(authDir, { recursive: true });
  await writeFile(
    path.join(authDir, 'admin.json'),
    JSON.stringify({ username: adminUser, password: adminPass }),
  );
  console.log(`[global-setup] 管理员就绪：${adminUser}`);
}
