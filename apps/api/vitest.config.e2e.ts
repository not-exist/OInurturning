import { defineConfig } from 'vitest/config';

/**
 * 全链路 E2E 配置（真配置 docs/data，需数据库）
 * - 仅包含 journey-full.e2e.test.ts
 * - 单独跑在 e2e Action，排除在默认 test 之外
 */
export default defineConfig({
  test: {
    name: 'e2e',
    include: ['tests/journey-full.e2e.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
    sequence: { shuffle: false },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: 60_000,
    hookTimeout: 30_000,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
});
