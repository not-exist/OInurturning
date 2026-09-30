import type { Prisma } from '@prisma/client';
import { getConfig } from '../../config/loader.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import type { TutorialStepDef } from '@oinur/shared';
import { resolveProgress, unlockedForStep } from './routing.js';

export function tutorialConfig() {
  const cfg = getConfig();
  if (!cfg?.tutorial) throw new Error('[tutorial] CONFIG 未加载');
  return cfg.tutorial;
}

export function getSteps(): TutorialStepDef[] {
  return tutorialConfig().steps;
}

export interface TutorialStateView {
  step: number;
  completed: boolean;
  total: number;
  steps: TutorialStepDef[];
  unlocked: string[];
  current: TutorialStepDef | null;
  /** 仅 do_recruit 步下发：在册 ACTIVE 学员数与该步门槛，供前端渲染「还需招募 N 人」 */
  studentsOwned?: number;
  studentsRequired?: number;
}

export type AdvanceReason = 'manual' | 'auto';

/** 统一的视图构造：step 一律是归一化后的值（越界钳到配置范围），unlocked 由 routing 计算 */
function stateView(
  step: number,
  completed: boolean,
  steps: TutorialStepDef[],
  roster?: { studentsOwned: number; studentsRequired: number },
): TutorialStateView {
  return {
    step,
    completed,
    total: steps.length,
    steps,
    unlocked: unlockedForStep(step, completed, steps),
    current: completed ? null : (steps[step] ?? null),
    ...(roster ?? {}),
  };
}

export async function getTutorialState(userId: number): Promise<TutorialStateView> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const steps = getSteps();
  // ADMIN 豁免引导锁（与 guard.ts 同口径）：状态视图必须一致，否则前端 overlay 仍会罩住
  // 管理端页面挡住所有点击（e2e admin spec 曾因此 3 分钟超时）。
  if (user.role === 'ADMIN') {
    return stateView(Math.max(steps.length - 1, 0), true, steps);
  }
  const progress = resolveProgress(user, steps);
  const cur = progress.current;
  // 只有 do_recruit 步才查在册人数：其余步不该为一个永远不渲染的字段付一次 COUNT
  const roster = cur?.action === 'do_recruit' && (cur.requires_students ?? 0) > 0
    ? {
        studentsOwned: await prisma.student.count({ where: { userId, status: 'ACTIVE' } }),
        studentsRequired: cur.requires_students as number,
      }
    : undefined;
  return stateView(progress.step, progress.completed, steps, roster);
}

async function grantReward(tx: Prisma.TransactionClient, userId: number, reward: NonNullable<TutorialStepDef['reward']>) {
  if (reward.money && reward.money > 0) {
    await tx.user.update({ where: { id: userId }, data: { money: { increment: reward.money } } });
  }
  if (reward.reputation && reward.reputation > 0) {
    await tx.user.update({ where: { id: userId }, data: { reputation: { increment: reward.reputation } } });
    await tx.reputationLog.create({ data: { userId, delta: reward.reputation, reason: 'TUTORIAL' } });
  }
  if (reward.item && reward.count) {
    await tx.userItem.upsert({
      where: { userId_itemId: { userId, itemId: reward.item } },
      create: { userId, itemId: reward.item, quantity: reward.count },
      update: { quantity: { increment: reward.count } },
    });
  }
  if (reward.badge) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const badges = Array.isArray(user.badges) ? [...(user.badges as string[])] : [];
    if (!badges.includes(reward.badge)) {
      badges.push(reward.badge);
      await tx.user.update({ where: { id: userId }, data: { badges } });
    }
  }
}

/**
 * 推进引导步骤（只允许严格 +1，回退与跳步一律 STATE_CONFLICT）。
 * 奖励在离开当前步时发放一次；同一步重复推进幂等且不发奖（否则可交替刷奖）。
 * `reason` 是服务端证据：`manual` 只对纯展示步（action=none）开放；
 * 行为步（visit 系列 / do 系列）只能由对应功能服务端以 `auto` + 匹配的 action 触发。
 */
export async function advanceTutorial(
  userId: number,
  targetStep: number,
  opts: { reason: AdvanceReason; action?: TutorialStepDef['action'] },
): Promise<TutorialStateView> {
  const steps = getSteps();
  if (!Number.isInteger(targetStep) || targetStep < 0 || targetStep >= steps.length) {
    throw new ApiError('VALIDATION_FAILED', { resource: 'tutorial', reason: 'step 越界' });
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const progress = resolveProgress(user, steps);
    // 已完成：幂等返回，不再发任何奖励
    if (progress.completed) return stateView(progress.step, true, steps);
    // 重放当前步：幂等返回，必须在发奖之前
    if (targetStep === progress.step) return stateView(progress.step, false, steps);
    // 只允许按顺序前进一步：回退（targetStep < 当前）与跳步（> 当前 + 1）都拒绝
    if (targetStep !== progress.step + 1) {
      throw new ApiError('STATE_CONFLICT', {
        resource: 'tutorial',
        reason: `需按顺序完成，当前 ${progress.step}，目标 ${targetStep}`,
      });
    }
    const cur = steps[progress.step];
    if (opts.reason === 'manual') {
      if (cur?.action !== 'none') {
        throw new ApiError('STATE_CONFLICT', {
          resource: 'tutorial',
          action: cur?.action,
          reason: '该步需在对应功能中完成',
        });
      }
    } else if (cur?.action !== opts.action) {
      throw new ApiError('STATE_CONFLICT', {
        resource: 'tutorial',
        action: cur?.action,
        reason: `自动推进证据不匹配：当前步为 ${cur?.action}`,
      });
    }
    if (cur?.reward) {
      await grantReward(tx, userId, cur.reward);
    }
    // 末步只前进不判完成：完成由 completeTutorial 显式确认（并只在那里发末步奖励）
    await tx.user.update({ where: { id: userId }, data: { tutorialStep: targetStep } });
    return stateView(targetStep, false, steps);
  });
}

/** 自动推进：若当前步骤的 action 匹配，则自动 advance 到下一步 */
export async function autoAdvanceIfNeeded(userId: number, action: TutorialStepDef['action']): Promise<void> {
  if (action === 'none') return;
  try {
    const steps = getSteps();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.tutorialCompleted) return;
    const step = resolveProgress(user, steps).step;
    const cur = steps[step];
    if (!cur) return;
    // 条件式招募步：不看触发动作，只看在册人数。老号（人数已达标）无需再招募一次即可通过，
    // 新号必须真的补员到门槛；两者共用同一步，避免「必须招募」把老号卡死在 6000+ 金的招募价上。
    if (cur.action === 'do_recruit') {
      const need = cur.requires_students ?? 0;
      if (need > 0) {
        const owned = await prisma.student.count({ where: { userId, status: 'ACTIVE' } });
        if (owned >= need) await advanceTutorial(userId, step + 1, { reason: 'auto', action: 'do_recruit' });
      }
      return;
    }
    if (cur.action !== action) return;
    await advanceTutorial(userId, step + 1, { reason: 'auto', action });
  } catch (err) {
    // 自动推进失败不影响主流程，但必须留痕（空 catch 会让用户永久卡步且无任何日志）
    logger.warn({ err, userId, action }, '[tutorial] auto advance failed');
  }
}

/** 完成引导：需先到达末步（skipTutorialForTest 走 force 后门），末步奖励只发一次 */
export async function completeTutorial(
  userId: number,
  opts: { force?: boolean; grantReward?: boolean } = {},
): Promise<TutorialStateView> {
  const steps = getSteps();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const progress = resolveProgress(user, steps);
    // 已完成：幂等返回，不重复发末步奖励
    if (progress.completed) return stateView(progress.step, true, steps);
    const last = steps.length - 1;
    if (!opts.force && progress.step !== last) {
      throw new ApiError('STATE_CONFLICT', {
        resource: 'tutorial',
        reason: `需先完成引导步骤（当前 ${progress.step}/${last}）`,
      });
    }
    const lastDef = steps[last];
    // grantReward=false 只给测试后门用（skip）：否则每个 e2e/vitest 账号都会被塞进
    // 末步奖励（+200 金币与徽章），污染"开局包快照"类断言（overview spec 曾因此变红）。
    if (opts.grantReward !== false && lastDef?.reward) {
      await grantReward(tx, userId, lastDef.reward);
    }
    await tx.user.update({
      where: { id: userId },
      data: { tutorialStep: last, tutorialCompleted: true },
    });
    return stateView(last, true, steps);
  });
}

export async function skipTutorialForTest(userId: number): Promise<TutorialStateView> {
  if (process.env.NODE_ENV !== 'test') {
    throw new ApiError('FORBIDDEN', { resource: 'tutorial', reason: '仅测试环境可跳过' });
  }
  // 纯测试便利：只改状态、不发任何奖励（与 tests/helpers.ts 的 unlockTutorial 同口径，
  // 保证测试账号的货币/背包不被引导奖励扰动）。
  return completeTutorial(userId, { force: true, grantReward: false });
}
