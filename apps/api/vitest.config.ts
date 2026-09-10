import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // 所有测试文件共享同一测试库（resetUsers 全表清），必须串行执行；
    // Vitest ≥2 默认 pool 为 forks，poolOptions.threads 会被忽略，故用 fileParallelism 串行化
    fileParallelism: false,
    // DB 套件在共享 runner 上抖动大（如并发推进用例偶超 5s），放宽全局单测超时防误杀
    testTimeout: 15_000,
  },
});
