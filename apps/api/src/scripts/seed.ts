/**
 * M1 种子脚本（T1.7，一键演示环境）：pnpm -C apps/api seed
 *
 * 内容：演示账号 coach/demo1234（钱 5000、声誉 100）；3 名样例学员（common/good/elite 各一，
 * 属性取 student.md §3.3 中值 E，不做随机掷点——声誉加成在 rep=100 时 E'≈E，静态化避免漂移）；
 * 背包样例道具（改名卡/定心丸/体力药水/浓咖啡/奶茶/精力药剂/若干六维书）；2 道样例预制题
 * （专项训练可用，作者绑定样例学员）；并触发一次免费招募池生成（固定 seed rng，可复现）。
 *
 * 幂等：已存在 coach 账号则跳过（提示已 seed）。运行前先 importConfigs() 到 CONFIG，
 * 否则依赖 CONFIG 的路径（招募池生成）会挂。
 */
import bcrypt from 'bcryptjs';
import { Prisma, type QualityTier, type Sex } from '@prisma/client';
import { getConfig, importConfigs } from '../config/loader.js';
import { env } from '../config/env.js';
import { dayKey } from '../lib/clock.js';
import { prisma } from '../lib/prisma.js';
import { mulberry32 } from '../lib/rng.js';
import { bucketTalents, generatePool } from '../modules/academy/recruit-gen.js';

const DEMO_USERNAME = 'coach';
const DEMO_PASSWORD = 'demo1234';
const DEMO_MONEY = 5000;
const DEMO_REPUTATION = 100;
const SEED_RNG = 20_260_830;

interface StudentTemplate {
  name: string;
  qualityTier: QualityTier;
  sex: Sex;
  /** 六维各自中值（§3.3 的 E；六维同值） */
  dim: number;
  code: number;
  thinking: number;
  setting: number;
  focusCap: number;
  energyMax: number;
  staminaRegen: number;
}

/** common/good/elite 三档的属性中值（student.md §3.3 主表 + 辅助属性表） */
const STUDENTS: StudentTemplate[] = [
  { name: '小明', qualityTier: 'COMMON', sex: 'MALE', dim: 8, code: 7, thinking: 8, setting: 3, focusCap: 45, energyMax: 55, staminaRegen: 48 },
  { name: '阿明', qualityTier: 'GOOD', sex: 'MALE', dim: 14, code: 13, thinking: 15, setting: 6, focusCap: 50, energyMax: 62, staminaRegen: 50 },
  { name: '千雪', qualityTier: 'ELITE', sex: 'FEMALE', dim: 22, code: 20, thinking: 24, setting: 10, focusCap: 58, energyMax: 70, staminaRegen: 52 },
];

/** 背包样例道具（itemId, 数量）。六维书取若干科目若干稀有度（定向训练耗材可见） */
const ITEMS: ReadonlyArray<readonly [string, number]> = [
  ['rename-card', 2],
  ['calm-pill', 3],
  ['stamina-potion', 2],
  ['coffee', 2],
  ['milk-tea', 2],
  ['vigor-drink', 1],
  ['book-ds-gray', 3],
  ['book-dp-yellow', 2],
  ['book-math-green', 1],
  ['book-graph-gray', 1],
  ['book-greedy-gray', 1],
  ['book-string-blue', 1],
];

/** 样例预制题（专项训练可用）。dominantDim 用大写维键；rarity 用小写六档（QUALITY_MULT 键）；作者绑定样例学员下标 */
const PROBLEMS = [
  { name: '区间最值与回溯模板', dominantDim: 'DS', rarity: 'green', quality: 42, authorIdx: 2 },
  { name: '01 背包入门', dominantDim: 'DP', rarity: 'yellow', quality: 30, authorIdx: 1 },
] as const;

async function main(): Promise<void> {
  // 运行前先导入配置到 CONFIG（否则招募池生成、道具列表等依赖 CONFIG 的路径会挂）
  await importConfigs();
  const config = getConfig();
  if (!config) throw new Error('[seed] importConfigs() 未加载 CONFIG');

  const existing = await prisma.user.findUnique({
    where: { username: DEMO_USERNAME },
    select: { id: true },
  });
  if (existing) {
    console.log(`[seed] demo 账号 ${DEMO_USERNAME} 已存在，跳过 seed`);
    return;
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: DEMO_USERNAME,
        passwordHash: bcrypt.hashSync(DEMO_PASSWORD, env.BCRYPT_COST),
        role: 'USER',
        money: DEMO_MONEY,
        reputation: DEMO_REPUTATION,
        badges: [],
        lastSettledAt: now,
      },
    });

    const studentIds: number[] = [];
    for (const t of STUDENTS) {
      const s = await tx.student.create({
        data: {
          userId: user.id,
          name: t.name,
          sex: t.sex,
          qualityTier: t.qualityTier,
          status: 'ACTIVE',
          ds: t.dim, dp: t.dim, math: t.dim, graph: t.dim, greedy: t.dim, str: t.dim,
          code: t.code, thinking: t.thinking, setting: t.setting,
          mindset: 2,
          focusCap: t.focusCap,
          energyMax: t.energyMax,
          energy: t.energyMax,
          stamina: 5,
          staminaRegen: t.staminaRegen,
          counters: {},
          lastSettledAt: now,
          recruitedAt: now,
        },
      });
      studentIds.push(s.id);
    }

    for (const [itemId, quantity] of ITEMS) {
      await tx.userItem.upsert({
        where: { userId_itemId: { userId: user.id, itemId } },
        create: { userId: user.id, itemId, quantity },
        update: { quantity: { increment: quantity } },
      });
    }

    for (const p of PROBLEMS) {
      await tx.problemLibraryEntry.create({
        data: {
          userId: user.id,
          authorStudentId: studentIds[p.authorIdx],
          name: p.name,
          dominantDim: p.dominantDim,
          rarity: p.rarity,
          quality: p.quality,
        },
      });
    }

    // 触发一次免费招募池生成：固定 seed rng，可复现（避免随机漂移）
    const candidates = generatePool(
      mulberry32(SEED_RNG),
      {
        reputation: DEMO_REPUTATION,
        ownedStudents: studentIds.length,
        buckets: bucketTalents(config.talents),
        recruitment: config.economy.recruitment,
      },
      5,
    );
    await tx.recruitPool.create({
      data: {
        userId: user.id,
        candidates: candidates as unknown as Prisma.InputJsonValue,
        generatedAt: now,
        refreshDayKey: dayKey(now),
      },
    });
  });

  console.log(
    `[seed] 完成：${DEMO_USERNAME}/${DEMO_PASSWORD}（钱 ${DEMO_MONEY}、声誉 ${DEMO_REPUTATION}），` +
      `${STUDENTS.length} 名样例学员，${ITEMS.length} 种道具，${PROBLEMS.length} 道预制题，免费招募池已生成`,
  );
}

main()
  .catch((e) => {
    console.error('[seed] 失败：', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
