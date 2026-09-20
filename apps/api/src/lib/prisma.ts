import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../config/env.js';

const log: Prisma.LogLevel[] = env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'];

/**
 * Prisma 7：Rust query engine 已移除，PrismaClient 必须显式传入 driver adapter。
 * 这里统一使用 `@prisma/adapter-mariadb`（MySQL/MariaDB 协议兼容），
 * 运行时不依赖任何引擎二进制，受限网络/离线环境同样可用。
 *
 * 说明：v6 时代的 `new PrismaClient({ datasources: { db: { url } } })` 回退分支
 * 在 v7 已被删除（`datasources`/`datasourceUrl` 均不再受支持），故不再保留。
 * CLI 侧的连接串改由 `apps/api/prisma.config.ts` 提供。
 */
export const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(env.DATABASE_URL),
  log,
});
