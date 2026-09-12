import { randomInt } from 'node:crypto';
import { Prisma, type QualityTier } from '@prisma/client';
import { onboardingConfigSchema, type OnboardingConfig } from '@oinur/shared';
import { getConfig } from '../../config/loader.js';
import { dayKey } from '../../lib/clock.js';
import { ApiError } from '../../lib/errors.js';
import { mulberry32 } from '../../lib/rng.js';
import { POOL_SIZE } from '../academy/service.js';
import {
  QUALITY_TO_TIER,
  bucketTalents,
  generateCandidateWithQuality,
  generatePool,
  type GenerateContext,
} from '../academy/recruit-gen.js';

/**
 * 开局包发放（数值权威：economy.yaml `onboarding` 分区）：
 * - 注册事务内调用（auth/service.register），新用户即得钱/声誉/固定品质学员/道具/招募池；
 * - 存量裸号由 grant-onboarding-backfill.ts 回填；
 * - 幂等键：users.onboardedAt（重复调用 → STATE_CONFLICT），钱/声誉走 increment、
 *   道具走 upsert-increment，天然兼容「已有部分资产」的老用户。
 * 学员属性/天赋与招募池同源（recruit-gen 掷点表），仅品质固定；天赋溯源记 RECRUIT。
 */

export function onboardingConfig(): OnboardingConfig {
  const config = getConfig();
  if (!config?.economy?.onboarding) throw new Error('[onboarding] economy.onboarding 未加载：importConfigs() 必须先于游戏逻辑执行');
  const parsed = onboardingConfigSchema.safeParse(config.economy.onboarding);
  if (!parsed.success) throw new Error('[onboarding] economy.onboarding 配置不完整');
  return parsed.data;
}

/** 运行时种子：发放无需跨请求复现，取密码学随机；单测可注入 rng 固定掷点 */
function newRng(): () => number {
  return mulberry32(randomInt(0, 2 ** 32));
}

export interface GrantedStudentView {
  id: number;
  name: string;
  qualityTier: QualityTier;
}

export interface GrantResult {
  students: GrantedStudentView[];
  items: { itemId: string; quantity: number }[];
  money: number;
  reputation: number;
}

export async function grantOnboardingPackage(
  tx: Prisma.TransactionClient,
  userId: number,
  opts: { rng?: () => number; now?: Date } = {},
): Promise<GrantResult> {
  const rng = opts.rng ?? newRng();
  const now = opts.now ?? new Date();
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError('NOT_FOUND', { resource: 'user', id: userId });
  if (user.onboardedAt) throw new ApiError('STATE_CONFLICT', { resource: 'onboarding', reason: 'already granted' });

  const config = getConfig();
  if (!config) throw new Error('[onboarding] CONFIG 未加载：importConfigs() 必须先于游戏逻辑执行');
  const cfg = onboardingConfig();
  const genCtx: GenerateContext = {
    reputation: user.reputation + cfg.reputation,
    ownedStudents: 0,
    buckets: bucketTalents(config.talents),
    recruitment: config.economy.recruitment,
  };

  // 1. 固定品质学员（按配置序列发放）
  const granted: GrantedStudentView[] = [];
  for (let i = 0; i < cfg.students.length; i += 1) {
    const spec = cfg.students[i]!;
    const candidate = generateCandidateWithQuality(rng, `onboarding-${i}`, spec.quality, genCtx);
    const student = await tx.student.create({
      data: {
        userId,
        name: candidate.name,
        sex: candidate.sex,
        qualityTier: QUALITY_TO_TIER[spec.quality],
        ds: candidate.attrs.ds, dp: candidate.attrs.dp, math: candidate.attrs.math,
        graph: candidate.attrs.graph, greedy: candidate.attrs.greedy, str: candidate.attrs.str,
        code: candidate.attrs.code, thinking: candidate.attrs.thinking, setting: candidate.attrs.setting,
        mindset: 2,
        focusCap: candidate.attrs.focusCap,
        energyMax: candidate.attrs.energyMax,
        energy: candidate.attrs.energyMax,
        staminaRegen: candidate.attrs.staminaRegen,
        lastSettledAt: now,
        recruitedAt: now,
      },
    });
    if (candidate.talents.length > 0) {
      await tx.studentTalent.createMany({
        data: candidate.talents.map((t) => ({
          studentId: student.id,
          talentId: t.talentId,
          acquiredVia: 'RECRUIT' as const,
        })),
      });
    }
    granted.push({ id: student.id, name: student.name, qualityTier: student.qualityTier });
  }

  // 2. 道具（upsert-increment：回填老用户已有同类道具时不断言冲突）
  for (const entry of cfg.items) {
    await tx.userItem.upsert({
      where: { userId_itemId: { userId, itemId: entry.id } },
      create: { userId, itemId: entry.id, quantity: entry.count },
      update: { quantity: { increment: entry.count } },
    });
  }

  // 3. 钱/声誉（increment：新用户 0+cfg，老用户在既有资产上叠加）+ 发放标记
  const updated = await tx.user.update({
    where: { id: userId },
    data: {
      money: { increment: cfg.money },
      reputation: { increment: cfg.reputation },
      onboardedAt: now,
    },
  });
  if (cfg.reputation > 0) {
    await tx.reputationLog.create({ data: { userId, delta: cfg.reputation, reason: 'ONBOARDING' } });
  }

  // 4. 招募池（缺失才建：注册路径恒新建；回填路径保留老用户已有池）
  const pool = await tx.recruitPool.findUnique({ where: { userId } });
  if (!pool) {
    const ownedStudents = await tx.student.count({ where: { userId, status: 'ACTIVE' } });
    await tx.recruitPool.create({
      data: {
        userId,
        candidates: generatePool(rng, { ...genCtx, reputation: updated.reputation, ownedStudents }, POOL_SIZE) as unknown as Prisma.InputJsonValue,
        generatedAt: now,
        refreshDayKey: dayKey(now),
      },
    });
  }

  return {
    students: granted,
    items: cfg.items.map((entry) => ({ itemId: entry.id, quantity: entry.count })),
    money: updated.money,
    reputation: updated.reputation,
  };
}
