import { defineConfig } from '@playwright/test';

/**
 * e2e 配置（tests/e2e/README.md 有本地运行说明）。
 *
 * - 串行执行（workers: 1）：所有 spec 共享同一个 e2e 库（oinur_e2e），
 *   历练含服务端周限流、PVP 需多账号编排，并行会互相污染；
 * - webServer 自动拉起 API（NODE_ENV=test 跳限流/日志，docs/data 真配置）与 web（vite dev，
 *   需要 dev 代理把 /api 转给 API——preview 没有代理，不能用）；
 * - globalSetup 注册并提升一个管理员账号，供 admin/pvp/journey spec 使用。
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 3000);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'mysql://oinur:oinur@127.0.0.1:3306/oinur_e2e';
const E2E_JWT_SECRET =
  process.env.E2E_JWT_SECRET ?? 'e2e-jwt-secret-0123456789abcdef-change-me';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  globalSetup: './global-setup.ts',
  // webServer 命令的 cwd 缺省为"配置文件所在目录"（即 tests/e2e），故用 ../../ 回到仓库根。
  webServer: [
    {
      command: 'pnpm -C ../../apps/api exec tsx src/index.ts',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'test',
        DATABASE_URL: E2E_DATABASE_URL,
        JWT_SECRET: E2E_JWT_SECRET,
      },
    },
    {
      command: 'pnpm -C ../../apps/web dev',
      url: `http://127.0.0.1:${WEB_PORT}/`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
