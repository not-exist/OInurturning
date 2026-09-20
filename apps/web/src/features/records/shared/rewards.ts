import { useCallback } from 'react';
import type { GrowthDelta, RewardLine } from '@oinur/shared';
import { useInventory, type ItemView } from '../../../lib/hooks';
import {
  DIMENSION_LABEL,
  DIRECT_BOOK_SUBJECT_LABEL,
  REWARD_LINE_LABEL,
  talentStatLabel,
} from '../../../lib/labels';
import { rarityLabel } from '../../../lib/rarity';

/**
 * 奖励文案：战报 RewardLine 与 PVP 奖池是两套独立体系，这里只做「中文名 + 数量」的展示拼接。
 * 道具中文名以服务端 /api/items 为准（不在前端维护第二份名录）；书籍名可由 id 规则推导。
 */

const BOOK_SUBJECT_LABEL: Record<string, string> = {
  ds: DIMENSION_LABEL.DS,
  dp: DIMENSION_LABEL.DP,
  math: DIMENSION_LABEL.MATH,
  graph: DIMENSION_LABEL.GRAPH,
  greedy: DIMENSION_LABEL.GREEDY,
  string: DIMENSION_LABEL.STRING,
  thinking: DIRECT_BOOK_SUBJECT_LABEL.thinking,
  coding: DIRECT_BOOK_SUBJECT_LABEL.coding,
  setting: DIRECT_BOOK_SUBJECT_LABEL.setting,
};

/** 已知名录（背包）优先，其次按书籍 id 规则推导，最后兜底中文 */
export function itemDisplayName(itemId: string, items: ItemView[] | undefined): string {
  const owned = items?.find((item) => item.itemId === itemId);
  if (owned !== undefined) return owned.name;
  const book = /^book-([a-z]+)-([a-z]+)$/.exec(itemId);
  if (book !== null) {
    const subject = BOOK_SUBJECT_LABEL[book[1]!];
    if (subject !== undefined) return `${subject}·${rarityLabel(book[2]!)}书`;
  }
  return '未知道具';
}

export function useItemName(): (itemId: string) => string {
  const inventory = useInventory();
  return useCallback(
    (itemId: string) => itemDisplayName(itemId, inventory.data),
    [inventory.data],
  );
}

export function rewardLineText(
  reward: RewardLine,
  itemName: (itemId: string) => string,
): string {
  const label = REWARD_LINE_LABEL[reward.type] ?? '奖励';
  switch (reward.type) {
    case 'first_clear_money':
      return `${label} · 金币 +${reward.amount}`;
    case 'first_clear_item':
    case 'milestone_item':
      return `${label} · ${itemName(reward.itemId)} ×${reward.count}`;
    case 'rank_bonus_money':
      return `${label}（第 ${reward.rank} 名）· 金币 +${reward.amount}`;
  }
}

/** 实战成长（GrowthDelta.delta 恒为 1，attr 是十维键之一） */
export function growthText(growth: GrowthDelta): string {
  return `${talentStatLabel(growth.attr)} +${growth.delta}`;
}
