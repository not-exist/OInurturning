import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // workspace 共享包打包进产物（其 exports 指向 TS 源，运行时无法直接加载）；
  // 其余 dependencies 保持外置，由镜像内 apps/api/node_modules 提供
  noExternal: ['@oinur/shared'],
});
