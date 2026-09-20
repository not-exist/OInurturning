import { defineConfig } from 'vitest/config';

/**
 * 集成测试配置（默认）
 * - 共享同一测试库 oinur_test，依赖 global-setup 重建库结构
 * - 必须串行执行，避免跨文件污染
 * - 排除 e2e 旅程（由 vitest.config.e2e.ts 单独运行）
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/*.e2e.test.ts', '**/fixtures/**'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // 共享库 → 串行；Vitest ≥2 默认 pool 为 forks，fileParallelism 控制文件级并行
    fileParallelism: false,
    sequence: {
      shuffle: false,
      concurrent: false,
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        // 单进程复用，减少 fork 开销；测试本身已串行，单 fork 足够
        singleFork: true,
        execArgv: ['--max-old-space-size=4096'],
      },
    },
    // DB 套件在共享 runner 上抖动大（如并发推进用例偶超 5s），放宽超时防误杀
    testTimeout: 15_000,
    hookTimeout: 20_000,
    teardownTimeout: 10_000,
    // CI 下同时输出 github-actions 注解
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
    // 失败时保留最长 5 个用例的完整输出，便于定位
    outputFile: undefined,
    // 覆盖率按需开启：pnpm test:coverage
    coverage: {
      enabled: false,
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/scripts/**', 'src/index.ts'],
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
    },
  },
});
