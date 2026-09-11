/**
 * e2e 专用种子脚本（测试基础设施，非线上运维脚本）：
 *   pnpm -C apps/api e2e:seed fund <username> [--money N] [--reputation N] [--item id=qty ...]
 *   pnpm -C apps/api e2e:seed backdate-tournament <tournamentId>
 *
 * 背景：正常新用户 money=0 且游戏内无商城/注资入口，e2e 无法仅凭 UI 走完
 * 招募→培养→PVP 全链路；fund 直接写库注资注道具，等价于"运营后台手工拨款"。
 * backdate-tournament 把赛事 registerEndsAt/autoStartAt 回拨到过去，使管理端
 * start API 可以在 e2e 时间窗口内开赛（UI 创建时强制未来时间）。
 *
 * 环境：DATABASE_URL（e2e 库）、JWT_SECRET（≥32 字符，env 校验需要，内容任意）。
 * 不读 --env-file，一律走进程环境变量（CI 由 job env 注入）。
 */
import { prisma } from '../lib/prisma.js';

function usage(): never {
  console.error(
    [
      '用法：',
      '  e2e:seed fund <username> [--money N] [--reputation N] [--item id=qty ...]',
      '  e2e:seed backdate-tournament <tournamentId>',
    ].join('\n'),
  );
  process.exit(2);
}

const [command, target, ...rest] = process.argv.slice(2);
if (!command || !target) usage();

async function fund(username: string, args: string[]): Promise<void> {
  let money: number | undefined;
  let reputation: number | undefined;
  const items = new Map<string, number>();
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === '--money') {
      money = Number(args[i + 1]);
      i += 1;
    } else if (flag === '--reputation') {
      reputation = Number(args[i + 1]);
      i += 1;
    } else if (flag === '--item') {
      const pair = args[i + 1] ?? '';
      const [itemId, qty] = pair.split('=');
      if (!itemId || !qty || !Number.isInteger(Number(qty)) || Number(qty) <= 0) {
        console.error(`[e2e:seed] 非法 --item 参数：${pair}`);
        process.exit(2);
      }
      items.set(itemId, (items.get(itemId) ?? 0) + Number(qty));
      i += 1;
    } else {
      console.error(`[e2e:seed] 未知参数：${flag}`);
      process.exit(2);
    }
  }
  if (money !== undefined && (!Number.isInteger(money) || money < 0)) {
    console.error(`[e2e:seed] 非法 --money：${money}`);
    process.exit(2);
  }
  if (reputation !== undefined && (!Number.isInteger(reputation) || reputation < 0)) {
    console.error(`[e2e:seed] 非法 --reputation：${reputation}`);
    process.exit(2);
  }

  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) {
    console.error(`[e2e:seed] 用户 ${username} 不存在`);
    process.exit(1);
  }
  if (money !== undefined || reputation !== undefined) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(money !== undefined ? { money } : {}),
        ...(reputation !== undefined ? { reputation } : {}),
      },
    });
  }
  for (const [itemId, qty] of items) {
    try {
      await prisma.userItem.upsert({
        where: { userId_itemId: { userId: user.id, itemId } },
        create: { userId: user.id, itemId, quantity: qty },
        update: { quantity: { increment: qty } },
      });
    } catch (error) {
      // 不依赖 PrismaClientKnownRequestError 类型收窄：duck-typing 读 code 即可
      const code =
        error instanceof Error && 'code' in error
          ? (error as Error & { code?: unknown }).code
          : undefined;
      if (code === 'P2003') {
        console.error(`[e2e:seed] 道具 ${itemId} 在 ConfigItem 中不存在（e2e 库未同步配置？）`);
        process.exit(1);
      }
      throw error;
    }
  }
  console.log(
    `[e2e:seed] fund ok: ${username}` +
      (money !== undefined ? ` money=${money}` : '') +
      (reputation !== undefined ? ` rep=${reputation}` : '') +
      (items.size > 0 ? ` items=${[...items].map(([k, v]) => `${k}x${v}`).join(',')}` : ''),
  );
}

async function backdateTournament(idRaw: string): Promise<void> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    console.error(`[e2e:seed] 非法 tournamentId：${idRaw}`);
    process.exit(2);
  }
  const past = new Date(Date.now() - 60_000);
  const result = await prisma.pvpTournament.updateMany({
    where: { id },
    data: { registerEndsAt: past, autoStartAt: past },
  });
  if (result.count === 0) {
    console.error(`[e2e:seed] 赛事 ${id} 不存在`);
    process.exit(1);
  }
  console.log(`[e2e:seed] backdate-tournament ok: id=${id}`);
}

async function main(): Promise<void> {
  if (command === 'fund') await fund(target, rest);
  else if (command === 'backdate-tournament') await backdateTournament(target);
  else usage();
}

main()
  .catch((error: unknown) => {
    console.error('[e2e:seed] 失败：', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
