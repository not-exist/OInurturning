import { useState, type JSX, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Dices, Search, Swords, TriangleAlert, UserRound } from 'lucide-react';
import type { BattleReplay as BattleReplayData } from '@oinur/shared';
import { apiErrorMessage } from '../../lib/api';
import { BattleReplay } from '../records/BattleReplay';
import {
  useAdventureLogs,
  useChooseAdventure,
  useDrawAdventure,
  useInventory,
  useOverview,
  useStudents,
  useUseItem,
  type AdventureLogView,
} from '../../lib/hooks';
import {
  ADVENTURE_STATUS_LABEL,
  EVENT_ONESHOT,
  contestSideLabel,
  eventCategoryLabel,
  signed,
} from '../../lib/labels';
import {
  RARITY_BORDER,
  RARITY_FILL,
  RARITY_GLOW,
  RARITY_ICON,
  normRarity,
  rarityChip,
  rarityLabel,
} from '../../lib/rarity';
import { GLYPH, Icon, NAV_ICON, eventCategoryIcon, itemIcon } from '../../components/icons';
import {
  Btn,
  Chip,
  Empty,
  ErrorNote,
  HoverCard,
  InlineLoader,
  PageHeader,
  Panel,
} from '../../components/ui';
import { RosterPicker } from '../../components/RosterPicker';

const ROSTER_SIZE = 3;
const INVESTMENT_TIERS = [1, 2, 3] as const;
const INTEL_ITEM = 'intel-slip';

/** 对决类事件 3 人各自出题答题；其余事件队友只出体力，结算只落在队长身上。 */
function partyMode(category: string): { label: string; hint: string } {
  return category === 'duel'
    ? { label: '全队出战', hint: '三名队员各出一题、各答一题，独立扣精力与心态' }
    : { label: '仅队长', hint: '只有队长参与判定，队友仅承担体力投入' };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 悬浮卡内容行（HoverCard 的 tooltip 是 <span>，内容只用 span 保持合法嵌套） */
function HoverRow({ k, children }: { k: string; children: ReactNode }): JSX.Element {
  return (
    <span className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-fg-dim">{k}</span>
      <span className="tnum text-right text-fg">{children}</span>
    </span>
  );
}

function pips(value: number): JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3].map((slot) => (
        <span
          key={slot}
          aria-hidden
          className={`h-2.5 w-1.5 ${slot <= value ? 'bg-warn-400' : 'bg-ink-600'}`}
        />
      ))}
    </span>
  );
}

/** 事件结果 → 中文化摘要（奖励行类型见 adventure/service.ts 的 rewardLines） */
function rewardText(raw: unknown, namedItem: (itemId: string) => string): string | null {
  const line = asRecord(raw);
  const amount = typeof line.amount === 'number' ? line.amount : 0;
  const count = typeof line.count === 'number' ? line.count : 1;
  switch (line.type) {
    case 'money':
      return `金币 ${signed(amount)}`;
    case 'reputation':
      return `声誉 ${signed(amount)}`;
    case 'win_streak_bonus':
      return `连胜奖励 金币 +${amount}`;
    case 'item':
      return `获得${namedItem(String(line.itemId))}×${count}`;
    case 'consume_item':
      return `消耗${namedItem(String(line.itemId))}×${count}`;
    case 'bank_problem':
      return '题库收录 1 题';
    case 'buff':
      return '获得临时增益';
    default:
      return null;
  }
}

function settleText(log: AdventureLogView, namedItem: (itemId: string) => string): string {
  if (log.status === 'PENDING') return ADVENTURE_STATUS_LABEL.PENDING;
  const result = asRecord(log.results[log.results.length - 1]);
  if (result.status === 'AVOIDED') return '已回避';
  const parts: string[] = [];
  if (typeof result.duelWinnerSide === 'string') {
    parts.push(
      result.duelWinnerSide === 'DRAW'
        ? '对决平局'
        : `对决 ${contestSideLabel(result.duelWinnerSide)}取胜`,
    );
  }
  const check = asRecord(result.check);
  if (typeof check.success === 'boolean') parts.push(check.success ? '检定通过' : '检定未通过');
  for (const reward of Array.isArray(result.rewards) ? result.rewards : []) {
    const text = rewardText(reward, namedItem);
    if (text !== null) parts.push(text);
  }
  return parts.length > 0 ? parts.join(' · ') : '事件已结算';
}

function EventCard({
  adventure,
  pending,
  money,
  namedItem,
  held,
  onChoice,
  onPreview,
}: {
  adventure: AdventureLogView;
  pending: boolean;
  money: number | undefined;
  namedItem: (itemId: string) => string;
  held: (itemId: string) => boolean;
  onChoice: (optionIndex: number) => void;
  onPreview: (action: 'accept' | 'avoid') => void;
}): JSX.Element {
  const { event } = adventure;
  const rarity = normRarity(event.rarity);
  const mode = partyMode(event.category);
  const oneshot = EVENT_ONESHOT[event.code];
  const choices = event.choices;
  const thresholds = (choices ?? []).filter(
    (choice) => choice.requiresItem !== undefined || choice.costMoney !== undefined,
  );

  return (
    <section className="panel animate-rise" aria-labelledby="active-event">
      <div className="flex flex-wrap items-start gap-4 border-b border-ink-600/70 p-4">
        <span
          className={`flex size-12 shrink-0 items-center justify-center border ${RARITY_BORDER[rarity]} ${RARITY_FILL[rarity]} ${RARITY_GLOW[rarity]} ${
            rarity === 'RAINBOW' ? 'animate-rainbow-halo' : ''
          }`}
        >
          <Icon icon={eventCategoryIcon(event.category)} className={`size-5 ${RARITY_ICON[rarity]}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <HoverCard
              width="w-80"
              content={
                <span className="block space-y-1.5">
                  <span className="block text-xs font-semibold text-fg">{event.name}</span>
                  <HoverRow k="类别">{eventCategoryLabel(event.category)}</HoverRow>
                  <HoverRow k="稀有度">{rarityLabel(event.rarity)}</HoverRow>
                  <HoverRow k="体力档">×{event.staminaCost}</HoverRow>
                  <HoverRow k="出战方式">{mode.label}</HoverRow>
                  <HoverRow k="事件编号">{event.code}</HoverRow>
                  {thresholds.length > 0 && (
                    <span className="block pt-1 text-[11px] text-fg-dim">
                      分支门槛：
                      {thresholds
                        .map((choice) =>
                          [
                            choice.requiresItem === undefined
                              ? ''
                              : `需${namedItem(choice.requiresItem)}`,
                            choice.costMoney === undefined ? '' : `金币 ${choice.costMoney}`,
                          ]
                            .filter((part) => part !== '')
                            .join(' / '),
                        )
                        .join('；')}
                    </span>
                  )}
                </span>
              }
            >
              <h2 id="active-event" className="text-base font-semibold text-fg">
                {event.name}
              </h2>
            </HoverCard>
            <span className={`px-1.5 py-0.5 text-[11px] ${rarityChip(event.rarity)}`}>
              {rarityLabel(event.rarity)}
            </span>
            <Chip>{eventCategoryLabel(event.category)}</Chip>
            <Chip>
              {pips(event.staminaCost)}
              体力 ×{event.staminaCost}
            </Chip>
            <Chip icon={event.category === 'duel' ? Swords : UserRound}>{mode.label}</Chip>
            {oneshot !== undefined && (
              <Chip icon={TriangleAlert} className="border-warn-400/60 bg-warn-400/10 text-warn-400">
                不可重复 · {oneshot}
              </Chip>
            )}
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">{event.description}</p>
          <p className="mt-1 text-[11px] text-fg-dim">{mode.hint}</p>
        </div>
      </div>

      {adventure.preview ? (
        <div className="flex flex-wrap items-center gap-2 p-4">
          <p className="mr-auto text-xs text-fg-dim">
            情报已揭示事件本身，但分支仍未知：接受将投入全队体力，回避则安全退出（本次不消耗体力）。
          </p>
          <Btn
            variant="primary"
            data-testid="adventure-accept"
            disabled={pending}
            onClick={() => onPreview('accept')}
          >
            接受历练
          </Btn>
          <Btn data-testid="adventure-avoid" disabled={pending} onClick={() => onPreview('avoid')}>
            回避
          </Btn>
        </div>
      ) : adventure.status === 'PENDING' && choices !== null ? (
        <div className="space-y-2 p-4">
          {choices.map((choice) => {
            const missingItem =
              choice.requiresItem !== undefined && !held(choice.requiresItem);
            const shortMoney =
              choice.costMoney !== undefined && money !== undefined && money < choice.costMoney;
            const blocked = !choice.available || missingItem || shortMoney;
            const reason = !choice.available
              ? '暂不可用'
              : missingItem
                ? '缺道具'
                : shortMoney
                  ? '金币不足'
                  : null;
            return (
              <button
                key={choice.index}
                type="button"
                data-testid={`adventure-choice-${choice.index}`}
                disabled={blocked || pending}
                onClick={() => onChoice(choice.index)}
                className={`flex w-full items-center justify-between gap-3 border px-3 py-2.5 text-left text-sm transition-colors ${
                  blocked
                    ? 'cursor-not-allowed border-ink-600/60 bg-ink-850/40 text-fg-faint'
                    : 'border-ink-600 bg-ink-800/40 text-fg hover:border-cyber-400/60 hover:bg-cyber-400/5'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center border border-ink-600 font-mono text-[11px] text-fg-dim">
                    {choice.index + 1}
                  </span>
                  <span className="min-w-0">{choice.text}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11px]">
                  {choice.costMoney !== undefined && (
                    <span className={shortMoney ? 'text-bad-400' : 'text-warn-400'}>
                      <Icon icon={GLYPH.money} className="mr-1 inline size-3" />
                      金币 {choice.costMoney}
                    </span>
                  )}
                  {choice.requiresItem !== undefined && (
                    <span className={missingItem ? 'text-bad-400' : 'text-fg-muted'}>
                      <Icon
                        icon={itemIcon(choice.requiresItem)}
                        className="mr-1 inline size-3"
                      />
                      需持有{namedItem(choice.requiresItem)} · 选用后消耗
                    </span>
                  )}
                  {reason !== null && <span className="text-fg-faint">{reason}</span>}
                </span>
              </button>
            );
          })}
          {pending && (
            <div className="pt-1">
              <InlineLoader>服务端正在结算本次抉择…</InlineLoader>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1 p-4">
          <p className="text-sm text-fg-muted">{settleText(adventure, namedItem)}</p>
          <p className="text-[11px] text-fg-dim">
            {adventure.status === 'RESOLVED'
              ? '事件已结算，结果计入上方记录。'
              : '等待下一步抉择。'}
          </p>
        </div>
      )}
    </section>
  );
}

export function AdventurePage(): JSX.Element {
  const students = useStudents();
  const inventory = useInventory();
  const logs = useAdventureLogs();
  const overview = useOverview();
  const draw = useDrawAdventure();
  const choose = useChooseAdventure();
  const activate = useUseItem();
  const navigate = useNavigate();
  const [roster, setRoster] = useState<number[]>([]);
  const [tier, setTier] = useState<1 | 2 | 3>(1);
  const [active, setActive] = useState<AdventureLogView>();
  const [battleReplay, setBattleReplay] = useState<BattleReplayData>();
  const [intelReady, setIntelReady] = useState(false);

  if (students.isPending || inventory.isPending || logs.isPending) {
    return <InlineLoader>正在接入历练频道…</InlineLoader>;
  }
  if (
    students.isError ||
    inventory.isError ||
    logs.isError ||
    !students.data ||
    !inventory.data ||
    !logs.data
  ) {
    return (
      <ErrorNote
        onRetry={() => {
          void students.refetch();
          void inventory.refetch();
          void logs.refetch();
        }}
      >
        历练数据读取失败：{apiErrorMessage(students.error ?? inventory.error ?? logs.error)}
      </ErrorNote>
    );
  }

  if (battleReplay !== undefined) {
    return (
      <BattleReplay
        replay={battleReplay}
        onOpenReport={(recordId) => navigate(`/records/${recordId}?details=1`)}
        onReturn={() => setBattleReplay(undefined)}
      />
    );
  }

  const items = new Map(inventory.data.map((item) => [item.itemId, item]));
  const namedItem = (itemId: string): string => {
    const name = items.get(itemId)?.name;
    return name === undefined ? '道具' : `「${name}」`;
  };
  const held = (itemId: string): boolean => (items.get(itemId)?.quantity ?? 0) > 0;
  const money = overview.data?.me.money;

  const rosterReady = roster.length === ROSTER_SIZE;
  const activeLog = active ?? logs.data.find((log) => log.status === 'PENDING');
  const hasPending = activeLog?.status === 'PENDING';
  const intelHeld = items.get(INTEL_ITEM)?.quantity ?? 0;

  const drawEvent = (): void => {
    if (!rosterReady) return;
    draw.mutate({ roster, tier }, { onSuccess: (result) => setActive(result) });
  };
  const chooseEvent = (input: { action?: 'accept' | 'avoid'; optionIndex?: number }): void => {
    if (activeLog === undefined) return;
    choose.mutate(
      { id: activeLog.id, ...input },
      {
        onSuccess: (result) => {
          setActive(result.adventure);
          // 接受/回避都会让服务端清掉情报标记，界面同步回到未激活态。
          if (input.action !== undefined) setIntelReady(false);
          if (result.replay !== undefined) setBattleReplay(result.replay);
        },
      },
    );
  };

  return (
    <div data-testid="adventure-page" className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow="历练"
        title="历练"
        description="投入体力换一次未知遭遇：资源、成长，或一场必须现场解决的对决。"
        actions={<Chip icon={UserRound}>3 人小队 · 队长带队</Chip>}
      />

      <Panel id="adventure-depart" className="scroll-mt-20" title="出发准备" eyebrow="出发" corners>
        <RosterPicker
          students={students.data}
          selectedIds={roster}
          min={ROSTER_SIZE}
          max={ROSTER_SIZE}
          onChange={setRoster}
          dataTestIdPrefix="adventure-roster"
        />

        <div className="mt-4 grid gap-4 border-t border-ink-600/60 pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <span className="eyebrow mb-2 block">投入体力</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {INVESTMENT_TIERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`adventure-tier-${value}`}
                  aria-pressed={tier === value}
                  className={`flex items-center gap-2 border px-3 py-1.5 text-sm transition-colors ${
                    tier === value
                      ? 'border-cyber-400/70 bg-cyber-400/15 text-cyber-300'
                      : 'border-ink-600 bg-ink-800/40 text-fg-dim hover:border-ink-500 hover:text-fg'
                  }`}
                  onClick={() => setTier(value)}
                >
                  {pips(value)}
                  <span className="tnum">×{value}</span>
                </button>
              ))}
              <span className="ml-1 text-[11px] text-fg-dim">
                抽取即扣除全队各 {tier} 点体力
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Btn
              variant="primary"
              data-testid="adventure-draw"
              disabled={!rosterReady || hasPending || draw.isPending}
              onClick={drawEvent}
            >
              {draw.isPending ? (
                <InlineLoader>抽取中…</InlineLoader>
              ) : (
                <>
                  <Icon icon={Dices} className="size-4" />
                  开始历练
                </>
              )}
            </Btn>
            <Btn
              variant={intelReady ? 'primary' : 'ghost'}
              data-testid="adventure-intel"
              disabled={intelReady || intelHeld < 1 || activate.isPending}
              onClick={() =>
                activate.mutate({ itemId: INTEL_ITEM }, { onSuccess: () => setIntelReady(true) })
              }
            >
              <Icon icon={Search} className="size-4" />
              {intelReady ? '情报已激活' : `激活情报条（${intelHeld}）`}
            </Btn>
          </div>
        </div>

        {!rosterReady && (
          <p className="mt-3 text-xs text-fg-dim">
            选择 3 名学员组成小队后方可出发（当前 {roster.length}/{ROSTER_SIZE}）。
          </p>
        )}
        {!intelReady && intelHeld < 1 && (
          <p className="mt-2 text-[11px] text-fg-dim">
            未持有情报条：抽取会立刻结算并扣除体力，无法先看事件再决定。
          </p>
        )}
        <div className="mt-3 space-y-2">
          {draw.isError && (
            <ErrorNote>
              <span data-testid="adventure-draw-error">
                抽取失败：{apiErrorMessage(draw.error)}
              </span>
            </ErrorNote>
          )}
          {choose.isError && (
            <ErrorNote>
              <span data-testid="adventure-choose-error">
                结算失败：{apiErrorMessage(choose.error)}
              </span>
            </ErrorNote>
          )}
          {activate.isError && (
            <ErrorNote>情报激活失败：{apiErrorMessage(activate.error)}</ErrorNote>
          )}
        </div>
      </Panel>

      {students.data.length < ROSTER_SIZE && (
        <Empty
          icon={GLYPH.student}
          title={`至少需要 ${ROSTER_SIZE} 名学员出发`}
          action={
            <Btn variant="primary" onClick={() => navigate('/academy')}>
              前往高级学院招募
            </Btn>
          }
        >
          历练为 3 人小队，招募满 3 名学员后即可投入体力探索未知事件。
        </Empty>
      )}

      {activeLog !== undefined && (
        <EventCard
          adventure={activeLog}
          pending={choose.isPending}
          money={money}
          namedItem={namedItem}
          held={held}
          onPreview={(action) => chooseEvent({ action })}
          onChoice={(optionIndex) => chooseEvent({ optionIndex })}
        />
      )}

      <Panel
        title="历练记录"
        eyebrow="记录"
        bodyClassName="p-0"
        actions={<span className="text-xs text-fg-dim">最近 {logs.data.length} 条</span>}
      >
        {logs.data.length === 0 ? (
          <div className="p-4">
            <Empty
              icon={NAV_ICON.adventure}
              title="暂无历练记录"
              action={
                <a
                  href="#adventure-depart"
                  className="inline-flex cursor-pointer items-center gap-1.5 border border-ink-600 px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:border-ink-500 hover:text-fg"
                >
                  回到出发准备
                </a>
              }
            >
              投入体力抽取事件后，结果会按时间倒序记录在此。
            </Empty>
          </div>
        ) : (
          <ul data-testid="adventure-logs" className="divide-y divide-ink-600/50">
            {logs.data.map((log) => {
              const summary = settleText(log, namedItem);
              const pendingLog = log.status === 'PENDING';
              return (
                <li key={log.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <Icon
                    icon={eventCategoryIcon(log.event.category)}
                    className={`size-4 shrink-0 ${pendingLog ? 'text-warn-400' : RARITY_ICON[normRarity(log.event.rarity)]}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg">{log.event.name}</span>
                    <span className="mt-0.5 block text-[11px] text-fg-dim">
                      {eventCategoryLabel(log.event.category)} · {rarityLabel(log.event.rarity)} ·
                      体力 ×{log.tier}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    <span className={pendingLog ? 'text-warn-400' : 'text-fg-muted'}>{summary}</span>
                    <time className="mt-0.5 block text-[11px] text-fg-faint">
                      {new Date(log.createdAt).toLocaleString()}
                    </time>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
