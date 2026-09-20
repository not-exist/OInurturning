import { defineConfig } from 'vitest/config';

/**
 * 纯单元测试配置（无需数据库，并行执行，极速反馈）
 * 覆盖：引擎纯函数、RNG、配置校验、经济模拟、平衡回归、golden 快照等
 */
export default defineConfig({
  test: {
    name: 'unit',
    include: [
      'tests/contest-kernel.test.ts',
      'tests/contest-contracts.test.ts',
      'tests/contest-replay.test.ts',
      'tests/contest-rng.test.ts',
      'tests/contest-rng-replay.test.ts',
      'tests/duel-engine.test.ts',
      'tests/ranking-engine.test.ts',
      'tests/solve-kernel.test.ts',
      'tests/report-determinism.test.ts',
      'tests/npc-pool.test.ts',
      'tests/economy-simulation.test.ts',
      'tests/balance-regression.test.ts',
      'tests/config-m2-schema.test.ts',
    ],
    setupFiles: ['tests/setup.ts'],
    env: {
      DATABASE_URL: 'mysql://oinur:oinur@127.0.0.1:3306/oinur_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-32',
      PRISMA_CLIENT_ENGINE_TYPE: 'client',
    },
    // 无需 globalSetup，不碰数据库
    fileParallelism: true,
    sequence: {
      shuffle: false,
      concurrent: true,
    },
    pool: 'threads',
    poolOptions: {
      threads: {
        // 充分利用多核，单元测试无共享状态
        minThreads: 1,
        maxThreads: 4,
        isolate: true,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
    coverage: {
      enabled: false,
      provider: 'v8',
      include: ['src/modules/contest/**', 'src/modules/economy/**', 'src/config/**'],
      reporter: ['text'],
    },
  },
});
