// Prisma 7 CLI 配置：datasource URL 与迁移路径不再写在 schema.prisma 里。
// 注意：这里用 process.env 而非 prisma/config 的 env()，后者在变量缺失时会抛错，
// 而 `prisma generate`（CI 安装阶段、Docker 构建阶段）本就不需要数据库连接。
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// dotenv 依赖已移除，改用 Node 内置加载：与原 `dotenv/config` 语义一致——
// 读取当前工作目录的 .env，文件不存在则静默跳过，且不覆盖已导出的变量。
if (existsSync('.env')) process.loadEnvFile();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL as string,
  },
});
