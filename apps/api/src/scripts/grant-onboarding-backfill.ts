/**
 * 开局包回填（一次性运维脚本，幂等可重跑）：
 *   pnpm -C apps/api onboarding:backfill [--dry-run] [--limit N]
 *
 * 背景：开局包上线前注册的用户（onboardedAt 为空）处于 0 钱/0 誉/0 学员的死锁态，
 * 本脚本为其补发与新注册完全相同的开局包（economy.yaml `onboarding` 分区）。
 * - 目标：onboardedAt IS NULL 且未注销（deletedAt IS NULL）的用户；
 * - 幂等：grantOnboardingPackage 以 onboardedAt 为键，重复跑跳过已发放用户；
 * - 逐用户独立事务：单个失败不影响其他用户，末尾汇总失败清单并以 exit 1 退出；
 * - 先跑 --dry-run 确认影响面（见 docs/OPERATIONS.md §回填）。
 *
 * 依赖 DATABASE_URL（--env-file 注入）；运行前须已应用含 onboardedAt 的迁移。
 */
import { importConfigs } from '../config/loader.js';
import { prisma } from '../lib/prisma.js';
import { grantOnboardingPackage } from '../modules/onboarding/service.js';

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();

let dryRun = false;
let limit = 10_000;
for (let i = 0; i < args.length; i += 1) {
  const flag = args[i];
  if (flag === '--dry-run') {
    dryRun = true;
  } else if (flag === '--limit') {
    const n = Number(args[i + 1]);
    if (!Number.isInteger(n) || n <= 0) {
      console.error('[onboarding:backfill] 非法 --limit（须为正整数）');
      process.exit(2);
    }
    limit = n;
    i += 1;
  } else {
    console.error(`[onboarding:backfill] 未知参数：${flag}`);
    console.error('用法：pnpm -C apps/api onboarding:backfill [--dry-run] [--limit N]');
    process.exit(2);
  }
}

async function main(): Promise<void> {
  await importConfigs();
  const targets = await prisma.user.findMany({
    where: { onboardedAt: null, deletedAt: null },
    select: { id: true, username: true },
    orderBy: { id: 'asc' },
    take: limit,
  });
  console.log(`[onboarding:backfill] 待回填用户：${targets.length}${dryRun ? '（dry-run，不写库）' : ''}`);
  if (dryRun) {
    for (const t of targets.slice(0, 20)) console.log(`  - id=${t.id} username=${t.username}`);
    if (targets.length > 20) console.log(`  …另有 ${targets.length - 20} 人未列出`);
    return;
  }

  let granted = 0;
  const failed: { id: number; username: string; error: string }[] = [];
  for (const t of targets) {
    try {
      await prisma.$transaction(async (tx) => {
        await grantOnboardingPackage(tx, t.id);
      });
      granted += 1;
    } catch (error) {
      failed.push({ id: t.id, username: t.username, error: error instanceof Error ? error.message : String(error) });
    }
    if ((granted + failed.length) % 50 === 0) console.log(`[onboarding:backfill] 进度：${granted + failed.length}/${targets.length}`);
  }
  console.log(`[onboarding:backfill] 完成：成功 ${granted}，失败 ${failed.length}`);
  for (const f of failed) console.error(`  - id=${f.id} username=${f.username} error=${f.error}`);
  if (failed.length > 0) process.exit(1);
}

main()
  .catch((error: unknown) => {
    console.error('[onboarding:backfill] 失败：', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
