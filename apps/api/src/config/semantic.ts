import {
  CONFIG_RARITIES,
  ECONOMY_QUALITY_TIERS,
  lectureConfigSchema,
  type ConfigRarity,
  type EconomyConfig,
  type EventsConfig,
  type ItemDef,
  type ProblemConfig,
  type StagesConfig,
  type TalentDef,
} from '@oinur/shared';

export interface SemanticIssue {
  file: 'talents' | 'items' | 'economy' | 'problems' | 'stages' | 'events';
  path: string;
  message: string;
}

const RARITY_RANK = new Map<ConfigRarity, number>(CONFIG_RARITIES.map((r, i) => [r, i]));

/**
 * 语义交叉校验（zod 结构校验通过之后执行）：
 * 收集全部错误一次返回，绝不逐个试错（TECH-DESIGN §4.2）。
 */
export function runSemanticChecks(input: {
  talents: TalentDef[];
  items: ItemDef[];
  economy: EconomyConfig;
  problems?: ProblemConfig;
  stages?: StagesConfig;
  events?: EventsConfig;
}): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  checkTalents(input.talents, issues);
  checkItems(input.items, issues);
  checkEconomy(input.economy, issues);
  if (input.problems !== undefined) checkProblems(input.problems, issues);
  if (input.stages !== undefined) checkStages(input.stages, input.problems, input.items, issues);
  if (input.events !== undefined) checkEvents(input.events, input.items, issues);
  return issues;
}

function checkEvents(events: EventsConfig, items: ItemDef[], issues: SemanticIssue[]): void {
  const itemIds = new Set(items.map((item) => item.id));
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();
  const groupWeights = new Map<string, number>();

  for (const event of events.events) {
    if (seenIds.has(event.id)) {
      issues.push({ file: 'events', path: `events.${event.id}`, message: `事件 id 重复：${event.id}` });
    }
    seenIds.add(event.id);
    if (seenCodes.has(event.code)) {
      issues.push({ file: 'events', path: `events.${event.code}`, message: `事件 code 重复：${event.code}` });
    }
    seenCodes.add(event.code);

    if (!event.repeatable && event.once_per_student === undefined && event.server_weekly_limit === undefined) {
      issues.push({
        file: 'events',
        path: `events.${event.id}.repeatable`,
        message: '不可重复事件必须声明 once_per_student 或 server_weekly_limit',
      });
    }
    if (event.once_per_student === true && event.repeatable) {
      issues.push({
        file: 'events',
        path: `events.${event.id}.once_per_student`,
        message: 'once_per_student 事件不能是 repeatable',
      });
    }

    const group = `${event.stamina_cost}:${event.rarity}`;
    groupWeights.set(group, (groupWeights.get(group) ?? 0) + event.weight);
    visitEventReferences(event, `events.${event.id}`, itemIds, issues);
  }

  for (const [group, total] of groupWeights) {
    if (Math.abs(total - 100) > 1e-9) {
      issues.push({
        file: 'events',
        path: `events[${group}]`,
        message: `同体力档/稀有度的事件权重必须合计 100，实际为 ${total}`,
      });
    }
  }
}

function visitEventReferences(
  value: unknown,
  path: string,
  itemIds: ReadonlySet<string>,
  issues: SemanticIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitEventReferences(entry, `${path}.${index}`, itemIds, issues));
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (key === 'requires_item' && typeof entry === 'string' && !itemIds.has(entry)) {
      issues.push({ file: 'events', path: entryPath, message: `事件道具引用不存在：${entry}` });
    }
    if (key === 'consume' && entry !== null && typeof entry === 'object') {
      const itemId = 'item' in entry ? (entry as { item?: unknown }).item : undefined;
      if (typeof itemId === 'string' && !itemIds.has(itemId)) {
        issues.push({ file: 'events', path: `${entryPath}.item`, message: `事件道具引用不存在：${itemId}` });
      }
    }
    if (key === 'items' && Array.isArray(entry)) {
      entry.forEach((reward, index) => {
        if (reward !== null && typeof reward === 'object' && 'id' in reward) {
          const itemId = (reward as { id?: unknown }).id;
          if (typeof itemId === 'string' && !itemIds.has(itemId) && itemId !== 'dim-book') {
            issues.push({
              file: 'events',
              path: `${entryPath}.${index}.id`,
              message: `事件道具引用不存在：${itemId}`,
            });
          }
        }
      });
    }
    visitEventReferences(entry, entryPath, itemIds, issues);
  }
}

function checkProblems(problems: ProblemConfig, issues: SemanticIssue[]): void {
  const seenTemplates = new Set<string>();
  for (const template of problems.templates) {
    if (seenTemplates.has(template.id)) {
      issues.push({
        file: 'problems',
        path: `templates.${template.id}`,
        message: `题目模板 id 重复：${template.id}`,
      });
    }
    seenTemplates.add(template.id);
  }
}

function checkStages(
  stages: StagesConfig,
  problems: ProblemConfig | undefined,
  items: ItemDef[],
  issues: SemanticIssue[],
): void {
  const itemIds = new Set(items.map((item) => item.id));
  const templateTiers = new Set(problems?.templates.map((template) => template.tier));
  const stageKeys = new Set<string>();

  stages.stages.forEach((stage, stageIndex) => {
    const stageKey = `${stage.chapter}:${stage.stage_index}`;
    if (stageKeys.has(stageKey)) {
      issues.push({
        file: 'stages',
        path: `stages.${stageIndex}`,
        message: `关卡 key 重复：${stageKey}`,
      });
    }
    stageKeys.add(stageKey);

    stage.problem_slots.forEach((slot, slotIndex) => {
      if (problems !== undefined && !templateTiers.has(slot.tier)) {
        issues.push({
          file: 'stages',
          path: `stages.${stageIndex}.problem_slots.${slotIndex}.tier`,
          message: `题目 tier 无可用模板：${slot.tier}`,
        });
      }
    });

    const milestoneItems = stage.first_clear.milestone?.items ?? [];
    milestoneItems.forEach((reward, rewardIndex) => {
      if (!itemIds.has(reward.item)) {
        issues.push({
          file: 'stages',
          path: `stages.${stageIndex}.first_clear.milestone.items.${rewardIndex}.item`,
          message: `奖励道具引用不存在：${reward.item}`,
        });
      }
    });
  });

  stages.full_clear.items.forEach((reward, rewardIndex) => {
    if (!itemIds.has(reward.item)) {
      issues.push({
        file: 'stages',
        path: `full_clear.items.${rewardIndex}.item`,
        message: `全通奖励道具引用不存在：${reward.item}`,
      });
    }
  });
}

function checkTalents(talents: TalentDef[], issues: SemanticIssue[]): void {
  const byId = new Map<string, TalentDef>();
  for (const t of talents) {
    if (byId.has(t.id)) {
      issues.push({ file: 'talents', path: `talents.${t.id}`, message: `天赋 id 重复：${t.id}` });
    }
    byId.set(t.id, t);
  }

  // 引用存在性 + 稀有度单调升
  for (const t of talents) {
    if (t.upgrade_to === null) continue;
    const target = byId.get(t.upgrade_to);
    const path = `talents.${t.id}.upgrade_to`;
    if (!target) {
      issues.push({ file: 'talents', path, message: `upgrade_to 引用不存在：${t.upgrade_to}` });
      continue;
    }
    if ((RARITY_RANK.get(target.rarity) ?? 0) <= (RARITY_RANK.get(t.rarity) ?? 0)) {
      issues.push({
        file: 'talents',
        path,
        message: `升阶稀有度未单调升：${t.id}(${t.rarity}) → ${target.id}(${target.rarity})`,
      });
    }
  }

  // 无合并：任一天赋至多作为一个 upgrade_to 的目标
  const inbound = new Map<string, string[]>();
  for (const t of talents) {
    if (t.upgrade_to === null) continue;
    const list = inbound.get(t.upgrade_to) ?? [];
    list.push(t.id);
    inbound.set(t.upgrade_to, list);
  }
  for (const [target, sources] of inbound) {
    if (sources.length > 1) {
      issues.push({
        file: 'talents',
        path: `talents.${target}`,
        message: `升阶链合并：${sources.join('、')} 同时指向 ${target}（链条不得分叉或合并）`,
      });
    }
  }

  // 无环：沿 upgrade_to 链走访，重访即成环
  const reported = new Set<string>();
  for (const t of talents) {
    const seen = new Set<string>();
    let cur: TalentDef | undefined = t;
    while (cur?.upgrade_to != null) {
      if (seen.has(cur.id)) break; // 本链已确认有环，交由下一轮定位
      seen.add(cur.id);
      const next: TalentDef | undefined = byId.get(cur.upgrade_to);
      if (next && seen.has(next.id)) {
        const key = [...seen, next.id].sort().join('|');
        if (!reported.has(key)) {
          reported.add(key);
          issues.push({
            file: 'talents',
            path: `talents.${next.id}.upgrade_to`,
            message: `升阶链成环（cycle）：${[...seen, next.id].join(' → ')}`,
          });
        }
        break;
      }
      cur = next;
    }
  }
}

function checkItems(items: ItemDef[], issues: SemanticIssue[]): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) {
      issues.push({ file: 'items', path: `items.${it.id}`, message: `道具 id 重复：${it.id}` });
    }
    seen.add(it.id);
    // category/rarity/effect.kind 合法性由 zod schema 保证，无需重复检查
  }
}

function checkEconomy(economy: EconomyConfig, issues: SemanticIssue[]): void {
  for (const tier of ECONOMY_QUALITY_TIERS) {
    const v = economy.recruitment.quality_mult[tier];
    if (v < 1) {
      issues.push({
        file: 'economy',
        path: `recruitment.quality_mult.${tier}`,
        message: `quality_mult 四档须齐全且 ≥1，实得 ${v}`,
      });
    }
  }
  const lecture = economy.lecture;
  if (lecture !== undefined) {
    const parsed = lectureConfigSchema.safeParse(lecture);
    if (!parsed.success) return;
    const completeLecture = parsed.data;
    const ids = new Set<string>();
    let previousThreshold = -1;
    completeLecture.audience_tiers.forEach((tier, index) => {
      if (ids.has(tier.id)) {
        issues.push({ file: 'economy', path: `lecture.audience_tiers.${index}.id`, message: `讲课档位 id 重复：${tier.id}` });
      }
      ids.add(tier.id);
      if (tier.threshold <= previousThreshold) {
        issues.push({ file: 'economy', path: `lecture.audience_tiers.${index}.threshold`, message: '讲课门槛必须严格递增' });
      }
      previousThreshold = tier.threshold;
    });
    if (completeLecture.reputation_pay_curve.max_mult < completeLecture.reputation_pay_curve.min_mult) {
      issues.push({ file: 'economy', path: 'lecture.reputation_pay_curve', message: '讲课声誉乘区上限不能低于下限' });
    }
  }
}
