/**
 * 管理员初始化（T5.4 上线项）：把一名已注册用户提升为 ADMIN，或在首次启动时
 * 直接创建首个管理员账号。
 *
 * 用法（根脚本或 apps/api 目录直跑；注意 pnpm 会把脚本后的 `--` 原样透传，
 * 故 canonical 写法不带 `--`，带了也会被剥离）：
 *   pnpm admin:set promote <username>
 *   pnpm admin:set create <username> <password>
 *   pnpm -C apps/api admin:set promote <username>
 *
 * - promote：用户须已存在；已是 ADMIN 则幂等成功；
 * - create：注册并立即提升（密码 ≥8 位）；用户名已存在则报错，请改用 promote；
 * - 两种模式都写 AdminAuditLog（action=ADMIN_BOOTSTRAP），首个管理员 actor 记
 *   adminId=null、快照 system——审计留痕不绕过；
 * - 依赖 DATABASE_URL（-env-file 注入）；运行前已应用的迁移须包含 User/AdminAuditLog。
 */
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

const args = process.argv.slice(2);
// pnpm 会把脚本名后的 `--` 原样透传（如 `pnpm admin:set -- promote alice`），
// 这里容忍并剥离一个前导 `--`；canonical 写法见文件头注释（不带 `--`）。
if (args[0] === '--') args.shift();
const [mode, username, password] = args;

function usage(): never {
  console.error(
    [
      '用法：',
      '  pnpm admin:set promote <username>',
      '  pnpm admin:set create <username> <password>',
      '  pnpm -C apps/api admin:set promote <username>（apps/api 目录内直跑）',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

if (!mode || !username || (mode === 'create' && !password)) usage();
if (mode !== 'promote' && mode !== 'create') usage();
if (username.length < 3 || username.length > 32) {
  console.error('[set-admin] 用户名长度须为 3–32');
  process.exit(2);
}

async function main(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { username } });
    if (user !== null && mode === 'create') {
      throw new Error(`[set-admin] 用户名 ${username} 已存在；改用 promote ${username}`);
    }
    if (user === null && mode === 'promote') {
      throw new Error(`[set-admin] 用户 ${username} 不存在；如需新建请用 create`);
    }
    if (user === null) {
      const passwordHash = await bcrypt.hash(password!, env.BCRYPT_COST);
      user = await tx.user.create({
        data: { username, passwordHash, role: 'ADMIN' }, // 其余字段走 schema 默认值
      });
      await tx.adminAuditLog.create({
        data: {
          adminId: null,
          adminNameSnapshot: 'system',
          action: 'ADMIN_BOOTSTRAP',
          targetType: 'user',
          targetId: String(user.id),
          payload: { mode: 'create', username } as Prisma.InputJsonValue,
        },
      });
      console.log(`[set-admin] 已创建并提升管理员：${username} (id=${user.id})`);
      return;
    }
    if (user.role === 'ADMIN') {
      console.log(`[set-admin] ${username} 已是管理员，无需变更（idempotent）`);
      return;
    }
    await tx.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN', tokenVersion: { increment: 1 } }, // 使旧 refresh token 失效
    });
    await tx.adminAuditLog.create({
      data: {
        adminId: null,
        adminNameSnapshot: 'system',
        action: 'ADMIN_BOOTSTRAP',
        targetType: 'user',
        targetId: String(user.id),
        payload: { mode: 'promote', username } as Prisma.InputJsonValue,
      },
    });
    console.log(`[set-admin] 已提升管理员：${username} (id=${user.id})；其旧会话已失效需重新登录`);
  });
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
