import { useState, type JSX } from 'react';
import { Link } from 'react-router';
import { Lock, PenLine, Sparkles, type LucideIcon } from 'lucide-react';
import type { CountersView, StudentView } from '@oinur/shared';
import { ITEM_USE_LIMITS, USABLE_ITEM_ID_SET } from '@oinur/shared/item-usage';
import { ApiCallError, apiErrorMessage } from '../../lib/api';
import { useInventory, useStudents, useUseItem, type ItemView } from '../../lib/hooks';
import {
  DIRECT_BOOK_GAIN,
  DIRECT_BOOK_SUBJECTS,
  DIRECT_BOOK_SUBJECT_LABEL,
  ITEM_UNAVAILABLE_REASON,
  RENAME_CARD_ID,
  floor,
  itemCategoryLabel,
  type DirectBookSubject,
} from '../../lib/labels';
import {
  RARITY_BORDER,
  RARITY_FILL,
  RARITY_GLOW,
  RARITY_ICON,
  RARITY_ORDER,
  normRarity,
  rarityChip,
  rarityLabel,
} from '../../lib/rarity';
import { Icon, itemIcon } from '../../components/icons';
import {
  ActionLink,
  Btn,
  Chip,
  Empty,
  ErrorNote,
  HoverCard,
  InlineLoader,
  Modal,
  PageHeader,
  Panel,
} from '../../components/ui';

/** 属性硬顶（六维与三能力共用；精力/专注另有自己的浮动上限） */
const ATTR_CAP = 100;

/** 直用书科目 → 学员视图字段 */
const BOOK_ATTR_FIELD: Record<DirectBookSubject, 'thinking' | 'code' | 'setting'> = {
  thinking: 'thinking',
  coding: 'code',
  setting: 'setting',
};

/**
 * 内置限额（数值唯一真源 @oinur/shared 的 ITEM_USE_LIMITS）。
 * `day` 为 null 表示无周期锚点的终身计数（心流引擎每人 1 台）；
 * 日限类必须拿到服务端写回的当日键才计数——前端不重算日历，键不匹配一律视为 0。
 */
interface LimitRule {
  max: number;
  unit: string;
  day: { count: keyof CountersView; key: keyof CountersView } | null;
}

const ITEM_LIMIT: Partial<Record<string, LimitRule>> = {
  'milk-tea': { max: ITEM_USE_LIMITS.milkTeaDaily, unit: '杯', day: { count: 'milkTea', key: 'milkTeaKey' } },
  coffee: { max: ITEM_USE_LIMITS.coffeeDaily, unit: '杯', day: { count: 'coffeeDaily', key: 'coffeeDailyKey' } },
  'stamina-potion': {
    max: ITEM_USE_LIMITS.staminaPotionDaily,
    unit: '瓶',
    day: { count: 'staminaPotionDaily', key: 'staminaPotionDailyKey' },
  },
  'focus-engine': { max: ITEM_USE_LIMITS.focusEngineMaxUses, unit: '台', day: null },
};

type Availability = 'usable' | 'page' | 'locked';

const GROUPS: { id: Availability; title: string; hint: string; icon: LucideIcon }[] = [
  { id: 'usable', title: '可直接使用', hint: '选中学员即刻生效', icon: Sparkles },
  { id: 'page', title: '在对应页面使用', hint: '需要走专属入口', icon: PenLine },
  { id: 'locked', title: '暂不可用', hint: '当前版本还开放不了，先收在背包里', icon: Lock },
];

function availabilityOf(itemId: string): Availability {
  if (USABLE_ITEM_ID_SET.has(itemId)) return 'usable';
  if (itemId === RENAME_CARD_ID) return 'page';
  return 'locked';
}

/** 服务端已写入的周期键（会话内）；只有拿到它才判定日限 / 周限，前端不重算日历 */
interface PeriodKeys {
  day: string | null;
  week: string | null;
}

export function InventoryPage(): JSX.Element {
  const inv = useInventory();
  const students = useStudents();
  const [picker, setPicker] = useState<ItemView | null>(null);
  const [keys, setKeys] = useState<PeriodKeys>({ day: null, week: null });

  if (inv.isPending) return <InlineLoader>读取背包…</InlineLoader>;
  if (inv.isError || inv.data === undefined) {
    return (
      <ErrorNote onRetry={() => void inv.refetch()}>背包读取失败：{apiErrorMessage(inv.error)}</ErrorNote>
    );
  }

  const items = inv.data;
  const groups = GROUPS.map((g) => ({
    ...g,
    items: items
      .filter((i) => availabilityOf(i.itemId) === g.id)
      .sort((a, b) => RARITY_ORDER[normRarity(b.rarity)] - RARITY_ORDER[normRarity(a.rarity)]),
  })).filter((g) => g.items.length > 0);

  return (
    <div data-testid="inventory-page" className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        eyebrow="补给与道具"
        title="背包"
        description="能直用的道具在这里直接投给学员；限定场景生效的道具会在对应玩法里发挥作用。用完即扣，失败不消耗。"
      />

      {items.length === 0 ? (
        <Empty
          icon={Sparkles}
          title="背包空空如也"
          action={<ActionLink to="/story">去剧情赛程获取</ActionLink>}
        >
          参加剧情比赛、历练或前往高级学院讲课，都会让背包充实起来。
        </Empty>
      ) : (
        groups.map((g) => (
          <Panel
            key={g.id}
            eyebrow={`${g.items.length} 件`}
            title={g.title}
            actions={<span className="text-xs text-fg-dim">{g.hint}</span>}
          >
            <ul className="space-y-2">
              {g.items.map((item) => (
                <InventoryRow key={item.itemId} item={item} onUse={() => setPicker(item)} />
              ))}
            </ul>
          </Panel>
        ))
      )}

      {picker !== null && (
        <StudentPicker
          item={picker}
          students={students.data ?? []}
          loading={students.isPending}
          keys={keys}
          onUsed={(fresh) => setKeys((prev) => learnedKeys(prev, fresh))}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function InventoryRow({ item, onUse }: { item: ItemView; onUse: () => void }): JSX.Element {
  const norm = normRarity(item.rarity);
  const availability = availabilityOf(item.itemId);
  const subject = bookSubject(item.itemId);
  const rule = ITEM_LIMIT[item.itemId];
  const reason = ITEM_UNAVAILABLE_REASON[item.itemId] ?? '暂不可用';

  return (
    <li data-testid="inventory-row" data-itemid={item.itemId} className="panel flex items-start gap-3 p-3">
      <HoverCard className="shrink-0" content={<ItemDetail item={item} subject={subject} rule={rule} />}>
        <span
          className={`grid size-11 place-items-center border ${RARITY_BORDER[norm]} ${RARITY_FILL[norm]} ${RARITY_GLOW[norm]} ${
            norm === 'RAINBOW' ? 'animate-rainbow-halo' : ''
          }`}
        >
          <Icon
            icon={itemIcon(item.itemId, item.category)}
            className={`size-5 ${RARITY_ICON[norm]}`}
            strokeWidth={1.6}
          />
        </span>
      </HoverCard>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-fg">{item.name}</span>
          <span className={`border px-1.5 py-0.5 text-[11px] ${rarityChip(norm)}`}>{rarityLabel(norm)}</span>
          <span className={`numeral text-sm ${availability === 'locked' ? 'text-fg-dim' : 'text-fg'}`}>
            ×{item.quantity}
          </span>
          <Chip>{itemCategoryLabel(item.category)}</Chip>
          {rule !== undefined && <Chip className="text-warn-400">{ruleHint(rule)}</Chip>}
          {subject !== null && (
            <Chip className="text-warn-400">
              {`${DIRECT_BOOK_SUBJECT_LABEL[subject]}·每周 ${ITEM_USE_LIMITS.bookWeekCap} 点上限`}
            </Chip>
          )}
        </div>
        {item.effectDesc !== null && <p className="mt-1 text-xs text-fg-muted">{item.effectDesc}</p>}
        {item.description !== '' && <p className="mt-0.5 text-xs text-fg-dim">{item.description}</p>}
      </div>

      <div className="shrink-0 self-center">
        {availability === 'usable' ? (
          <Btn data-testid="item-use" variant="primary" size="sm" onClick={onUse}>
            使用
          </Btn>
        ) : availability === 'page' ? (
          <Link
            to="/students"
            className="inline-flex items-center gap-1.5 border border-arc-400/50 bg-arc-400/10 px-2.5 py-1.5 text-xs text-arc-300 transition-colors hover:bg-arc-400/20"
          >
            <Icon icon={PenLine} className="size-3.5" />
            去学员页改名
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center gap-1.5 border border-ink-600 bg-ink-800/70 px-2.5 py-1.5 text-xs text-fg-dim"
          >
            <Icon icon={Lock} className="size-3.5" />
            {reason}
          </span>
        )}
      </div>
    </li>
  );
}

/** 道具悬浮详情（名称 / 稀有度 / 分类 / 效果 / 描述 / 价格 / 限额） */
function ItemDetail({
  item,
  subject,
  rule,
}: {
  item: ItemView;
  subject: DirectBookSubject | null;
  rule: LimitRule | undefined;
}): JSX.Element {
  return (
    <span className="block space-y-1.5">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg">{item.name}</span>
        <span className={`border px-1.5 py-0.5 text-[11px] ${rarityChip(item.rarity)}`}>
          {rarityLabel(item.rarity)}
        </span>
      </span>
      <span className="block text-[11px] text-fg-dim">
        {itemCategoryLabel(item.category)}
        {item.price !== null ? ` · 售价 ${item.price} 金` : ''}
      </span>
      {item.effectDesc !== null && <span className="block text-xs text-fg-muted">{item.effectDesc}</span>}
      {item.description !== '' && <span className="block text-[11px] text-fg-dim">{item.description}</span>}
      {rule !== undefined && <span className="block text-[11px] text-warn-400">{ruleHint(rule)}</span>}
      {subject !== null && (
        <span className="block text-[11px] text-warn-400">
          {`单学员单属性每周最多获得 ${ITEM_USE_LIMITS.bookWeekCap} 点 ${DIRECT_BOOK_SUBJECT_LABEL[subject]} 增益，超出部分不计。`}
        </span>
      )}
    </span>
  );
}

/** 使用道具：选学员 → 限额与周限提示 → 确认 */
function StudentPicker({
  item,
  students,
  loading,
  keys,
  onUsed,
  onClose,
}: {
  item: ItemView;
  students: StudentView[];
  loading: boolean;
  keys: PeriodKeys;
  onUsed: (fresh: StudentView) => void;
  onClose: () => void;
}): JSX.Element {
  const use = useUseItem();
  // 未显式选择时默认落在第一名学员；名册仍未就绪时不预选，加载完成后自动补上
  const [selected, setSelected] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const selectedId = selected ?? students[0]?.id ?? null;
  const chosen = students.find((s) => s.id === selectedId) ?? null;
  const rule = ITEM_LIMIT[item.itemId];
  const subject = bookSubject(item.itemId);
  const used = rule !== undefined && chosen !== null ? usedOf(rule, chosen.counters, keys.day) : 0;
  const blocked = rule !== undefined && chosen !== null ? limitBlock(rule, used, item.name) : null;
  const book = subject !== null && chosen !== null ? bookOutcome(item, subject, chosen, keys.week) : null;

  return (
    <Modal
      open
      testId="item-picker"
      onClose={onClose}
      eyebrow={itemCategoryLabel(item.category)}
      title={`使用「${item.name}」`}
      width="max-w-lg"
      headerExtra={
        <span className={`border px-1.5 py-0.5 text-[11px] ${rarityChip(item.rarity)}`}>
          {rarityLabel(item.rarity)}
        </span>
      }
    >
      <div className="space-y-3">
        {item.effectDesc !== null && (
          <p className="border border-ink-600/70 bg-ink-850/50 px-3 py-2 text-xs text-fg-muted">
            {item.effectDesc}
          </p>
        )}

        {loading ? (
          <InlineLoader>读取学员名册…</InlineLoader>
        ) : students.length === 0 ? (
          <p className="border border-dashed border-ink-600 px-3 py-4 text-center text-sm text-fg-muted">
            暂无可选学员，请先招募学员。
          </p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {students.map((s) => (
              <label
                key={s.id}
                data-testid="item-picker-student"
                data-student-id={s.id}
                className={`flex cursor-pointer items-center gap-2 border px-2 py-1.5 text-sm transition-colors ${
                  selectedId === s.id
                    ? 'border-cyber-400/70 bg-cyber-400/10'
                    : 'border-transparent hover:border-ink-500'
                }`}
              >
                <input
                  type="radio"
                  name="item-student"
                  checked={selectedId === s.id}
                  onChange={() => setSelected(s.id)}
                />
                <span className="font-medium text-fg">{s.name}</span>
                <span className="numeral text-xs text-fg-dim">V {s.v}</span>
                <span className="ml-auto text-xs text-fg-dim">体力 {floor(s.stamina)}/5</span>
              </label>
            ))}
          </div>
        )}

        {chosen !== null && blocked !== null && (
          <p className="border border-warn-400/40 bg-warn-400/10 px-3 py-2 text-xs text-warn-400">{blocked}</p>
        )}

        {chosen !== null && subject !== null && book !== null && (
          <div className="border border-warn-400/40 bg-warn-400/10 px-3 py-2 text-xs text-warn-400">
            {book.loss > 0
              ? `本周剩余 ${book.headroom} 点，使用该书将损失 ${book.loss} 点。`
              : `本周该属性还可获得 ${book.headroom} 点，本书增益可全额生效。`}
            <span className="mt-0.5 block text-fg-dim">
              {`额度按「单学员 × 单属性」每周 ${ITEM_USE_LIMITS.bookWeekCap} 点计，${DIRECT_BOOK_SUBJECT_LABEL[subject]} 这一维单独结算。`}
            </span>
          </div>
        )}

        {chosen !== null && subject !== null && book === null && (
          <p className="border border-ink-600/70 bg-ink-850/50 px-3 py-2 text-xs text-fg-dim">
            {`本周书籍增益额度按「单学员 × 单属性」每周 ${ITEM_USE_LIMITS.bookWeekCap} 点计，超出部分不计入，具体以服务端结算为准。`}
          </p>
        )}

        {msg !== null && (
          <div data-testid="item-msg">
            <ErrorNote>{msg}</ErrorNote>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-ink-600/60 pt-3">
          <Btn variant="subtle" onClick={onClose}>
            取消
          </Btn>
          <Btn
            data-testid="item-use-confirm"
            variant="primary"
            disabled={chosen === null || blocked !== null || use.isPending}
            onClick={() => {
              if (chosen === null) return;
              use.mutate(
                { itemId: item.itemId, studentId: chosen.id },
                {
                  onSuccess: (r) => {
                    if ('counters' in r) onUsed(r);
                    onClose();
                  },
                  onError: (e) => setMsg(reasonText(e)),
                },
              );
            }}
          >
            {use.isPending ? '使用中…' : chosen !== null ? `给 ${chosen.name} 使用` : '确认使用'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function ruleHint(rule: LimitRule): string {
  return rule.day === null ? `每人限用 ${rule.max} ${rule.unit}` : `每日限用 ${rule.max} ${rule.unit}`;
}

/** 服务端写回的计数器即「此刻」的事实：以它的周期键作为本次会话的当前日/周键 */
function learnedKeys(prev: PeriodKeys, fresh: StudentView): PeriodKeys {
  const c = fresh.counters;
  return {
    day: c.milkTeaKey ?? c.coffeeDailyKey ?? c.staminaPotionDailyKey ?? prev.day,
    week: c.bookWeekKey ?? prev.week,
  };
}

function usedOf(rule: LimitRule, counters: CountersView, dayKey: string | null): number {
  if (rule.day === null) return num(counters.focusEngineUsed);
  if (dayKey === null || counters[rule.day.key] !== dayKey) return 0;
  return num(counters[rule.day.count]);
}

function limitBlock(rule: LimitRule, used: number, itemName: string): string | null {
  if (used < rule.max) return null;
  return rule.day === null
    ? `该学员已用过${itemName}（每人限 ${rule.max} ${rule.unit}）。`
    : `该学员今日已用完 ${used}/${rule.max} ${rule.unit}，换一名学员或等次日 04:00 后再用。`;
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/** 直用书：book-{科目}-{档}；科目即 counters.bookWeek 的键（六维书是训练耗材，不在白名单内） */
function bookSubject(itemId: string): DirectBookSubject | null {
  const m = /^book-([a-z]+)-(gray|yellow|green|blue|purple)$/.exec(itemId);
  const subject = m?.[1];
  return subject !== undefined && (DIRECT_BOOK_SUBJECTS as readonly string[]).includes(subject)
    ? (subject as DirectBookSubject)
    : null;
}

/** 周限损失预估：额度按「单学员 × 单属性」计，必须在选中学员 + 选中属性之后算 */
function bookOutcome(
  item: ItemView,
  subject: DirectBookSubject,
  student: StudentView,
  weekKey: string | null,
): { headroom: number; loss: number } | null {
  if (weekKey === null || student.counters.bookWeekKey !== weekKey) return null;
  const headroom = ITEM_USE_LIMITS.bookWeekCap - (student.counters.bookWeek?.[subject] ?? 0);
  const gain = DIRECT_BOOK_GAIN[normRarity(item.rarity)];
  const cur = student[BOOK_ATTR_FIELD[subject]];
  const actual = Math.max(0, Math.min(cur + Math.max(0, Math.min(gain, headroom)), ATTR_CAP) - cur);
  return { headroom: Math.max(0, headroom), loss: Math.max(0, Math.round(gain - actual)) };
}

/** 服务端 VALIDATION_FAILED 的 details.reason 是人话文案（如「每日限 2 杯，今日已用 2 杯」） */
function reasonText(e: unknown): string {
  if (e instanceof ApiCallError) {
    const details = e.details as { reason?: unknown } | undefined;
    const reason = details?.reason;
    if (typeof reason === 'string' && reason !== '') return reason;
  }
  return apiErrorMessage(e);
}
