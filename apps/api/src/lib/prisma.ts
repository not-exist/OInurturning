import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../config/env.js';

const log: Prisma.LogLevel[] = env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'];

/**
 * 双引擎支持：
 * - 缺省：Rust library engine（`prisma generate` 时需要下载 query engine 二进制）。
 * - `PRISMA_CLIENT_ENGINE_TYPE=client`：Rust-free query compiler（WASM）+
 *   `@prisma/adapter-mariadb` driver adapter，运行时不依赖任何引擎二进制
 *   （受限网络/离线环境可用；与 Prisma 7 的默认形态一致）。
 *   该模式下生成客户端需同时设置：
 *   `PRISMA_CLIENT_ENGINE_TYPE=client PRISMA_GENERATE_NO_ENGINE=1 prisma generate`。
 */
export const prisma =
  process.env.PRISMA_CLIENT_ENGINE_TYPE === 'client'
    ? new PrismaClient({ adapter: new PrismaMariaDb(env.DATABASE_URL), log })
    : new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } }, log });
