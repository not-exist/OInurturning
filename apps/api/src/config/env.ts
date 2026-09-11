import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 字节随机'),
  BCRYPT_COST: z.coerce.number().int().min(10).max(14).default(12),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  /** 配置即数据管线的 yaml 源目录；相对路径先按 cwd 解析，再按仓库根回退 */
  CONFIG_DIR: z.string().default('docs/data'),
  /** 限流参数（T5.4：允许运维不改代码调参；缺省即文档基线值） */
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60_000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[env] 环境变量校验失败：\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

/**
 * 生产安全护栏（T5.4）：拒绝示例/占位 JWT_SECRET——长度达标不代表可用。
 * .env.example 的 change-me-… 或含 xxxxxxx 的串一律视为未配置。
 */
if (isProd && /^(change-me|.*xxxxxxx)/i.test(env.JWT_SECRET)) {
  console.error(
    '[env] NODE_ENV=production 下 JWT_SECRET 仍为示例占位值。请执行 `pnpm secret` 生成强随机串后写入 .env。',
  );
  process.exit(1);
}
