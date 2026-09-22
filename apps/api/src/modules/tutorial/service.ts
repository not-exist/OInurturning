import type { Prisma } from '@prisma/client';
import { getConfig } from '../../config/loader.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { TutorialStepDef } from '@oinur/shared';
import { unlockedForStep } from './routing.js';

// 纯逻辑（前缀匹配/解锁计算）在 routing.js，这里 re-export 保持既有 import 路径可用
export { ROUTE_MAP, isApiAllowed, unlockedForStep } from './routing.js';

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
}

export async function getTutorialState(userId: number): Promise<TutorialStateView> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const steps = getSteps();
  const total = steps.length;
  const completed = user.tutorialCompleted;
  const step = completed ? total : Math.min(user.tutorialStep, total - 1);
  const unlocked = unlockedForStep(user.tutorialStep, completed, steps);
  const current = completed ? null : (steps[step] ?? null);
  return {
    step: user.tutorialStep,
    completed,
    total,
    steps,
    unlocked,
    current,
  };
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

export async function advanceTutorial(userId: number, targetStep: number): Promise<TutorialStateView> {
  const steps = getSteps();
  if (targetStep < 0 || targetStep >= steps.length) {
    throw new ApiError('VALIDATION_FAILED', { resource: 'tutorial', reason: 'step 越界' });
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.tutorialCompleted) {
      const unlocked = unlockedForStep(user.tutorialStep, true, steps);
      return {
        step: user.tutorialStep,
        completed: true,
        total: steps.length,
        steps,
        unlocked,
        current: null,
      };
    }
    if (targetStep !== user.tutorialStep + 1 && targetStep !== user.tutorialStep) {
      // 允许重放当前步（幂等），但不允许跳步
      if (targetStep > user.tutorialStep + 1) {
        throw new ApiError('STATE_CONFLICT', { resource: 'tutorial', reason: `需按顺序完成，当前 ${user.tutorialStep}，目标 ${targetStep}` });
      }
    }
    if (targetStep === user.tutorialStep) {
      // 幂等返回
      const unlocked = unlockedForStep(user.tutorialStep, false, steps);
      return {
        step: user.tutorialStep,
        completed: false,
        total: steps.length,
        steps,
        unlocked,
        current: steps[user.tutorialStep] ?? null,
      };
    }
    // 发放上一步的奖励？按设计，奖励在进入下一步时发放当前步的奖励，或发放目标步的前一步？
    // 我们设计：每步完成时发放该步的 reward，advance 到 next 时发放 current 的 reward
    const currentStepDef = steps[user.tutorialStep];
    if (currentStepDef?.reward) {
      await grantReward(tx, userId, currentStepDef.reward);
    }

    const isLast = targetStep === steps.length - 1;
    const completed = isLast;
    await tx.user.update({
      where: { id: userId },
      data: {
        tutorialStep: targetStep,
        tutorialCompleted: completed,
      },
    });

    // 最后一步的奖励也在完成时发放
    if (isLast) {
      const lastDef = steps[targetStep];
      if (lastDef?.reward) {
        await grantReward(tx, userId, lastDef.reward);
      }
    }

    const unlocked = unlockedForStep(targetStep, completed, steps);
    return {
      step: targetStep,
      completed,
      total: steps.length,
      steps,
      unlocked,
      current: completed ? null : (steps[targetStep] ?? null),
    };
  });
}

/** 自动推进：若当前步骤的 action 匹配，则自动 advance 到下一步 */
export async function autoAdvanceIfNeeded(userId: number, action: TutorialStepDef['action']): Promise<void> {
  if (action === 'none') return;
  try {
    const steps = getSteps();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.tutorialCompleted) return;
    const curIdx = user.tutorialStep;
    const cur = steps[curIdx];
    if (!cur) return;
    if (cur.action !== action) return;
    await advanceTutorial(userId, curIdx + 1);
  } catch {
    // 自动推进失败不影响主流程
  }
}

export async function completeTutorial(userId: number): Promise<TutorialStateView> {
  const steps = getSteps();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.tutorialCompleted) {
      return {
        step: user.tutorialStep,
        completed: true,
        total: steps.length,
        steps,
        unlocked: ['all'],
        current: null,
      };
    }
    // 依次发放所有未发放的奖励
    for (let i = user.tutorialStep; i < steps.length; i++) {
      const def = steps[i];
      if (def?.reward) {
        await grantReward(tx, userId, def.reward);
      }
    }
    await tx.user.update({
      where: { id: userId },
      data: { tutorialStep: steps.length - 1, tutorialCompleted: true },
    });
    return {
      step: steps.length - 1,
      completed: true,
      total: steps.length,
      steps,
      unlocked: ['all'],
      current: null,
    };
  });
}

export async function skipTutorialForTest(userId: number): Promise<TutorialStateView> {
  if (process.env.NODE_ENV !== 'test') {
    throw new ApiError('FORBIDDEN', { resource: 'tutorial', reason: '仅测试环境可跳过' });
  }
  return completeTutorial(userId);
}
