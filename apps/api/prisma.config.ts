// Prisma 7 CLI 配置：datasource URL 与迁移路径不再写在 schema.prisma 里。
// 注意：这里用 process.env 而非 prisma/config 的 env()，后者在变量缺失时会抛错，
// 而 `prisma generate`（CI 安装阶段、Docker 构建阶段）本就不需要数据库连接。
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL as string,
  },
});
