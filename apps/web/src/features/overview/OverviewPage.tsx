import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ChevronRight,
  CircleCheck,
  Compass,
  Dumbbell,
  GraduationCap,
  Megaphone,
  Presentation,
  RefreshCw,
  ScrollText,
  Trophy,
  Users,
} from 'lucide-react';
import { apiErrorMessage } from '../../lib/api';
import {
  useClaimChecklist,
  useNow,
  useOverview,
  useTalentDefs,
  type ChecklistStepId,
  type OverviewView,
  type TalentDefView,
} from '../../lib/hooks';
import {
  CHECKLIST_BADGE_LABEL,
  ADVENTURE_STATUS_LABEL,
  CONTEST_FORMAT_LABEL,
  CONTEST_RECORD_TYPE_LABEL,
  DIMENSION_LABEL,
  TRAINING_KIND_LABEL,
  eventCategoryLabel,
  floor,
  lectureTierLabel,
  signed,
  tierLabel,
} from '../../lib/labels';
import { TIER_TEXT, isTier, nextReputationTitle, reputationTitle } from '../../lib/rarity';
import {
  ActionLink,
  Btn,
  Chip,
  Empty,
  ErrorNote,
  HoverCard,
  InlineLoader,
  Meter,
  Numeral,
  PageHeader,
  Panel,
  RollingNumber,
} from '../../components/ui';
import { GLYPH, Icon, eventCategoryIcon, DIMENSION_ICON, type LucideIcon } from '../../components/icons';
import { QualityBadge, StudentHover } from '../students/StudentVisuals';

/**
 * 总览 = 指挥中心仪表盘：资源条 / 开局任务轨道 / 学员名册 / 剧情进程 / 招募池 / 动态时间线 / 公告板。
 * 看板只呈现「能动作的信息」，调试元数据不入主视。
 */
export function OverviewPage(): JSX.Element {
  const q = useOverview();
  const claim = useClaimChecklist();
  const talentsQ = useTalentDefs();
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const defs = useMemo(
    () => new Map<string, TalentDefView>((talentsQ.data ?? []).map((t) => [t.id, t])),
    [talentsQ.data],
  );

  if (q.isLoading) return <InlineLoader>指挥中心数据加载中…</InlineLoader>;
  if (q.isError || !q.data) {
    return <ErrorNote onRetry={() => void q.refetch()}>总览数据读取失败：请刷新重试。</ErrorNote>;
  }
  const ov = q.data;

  const allDone = ov.checklist.doneCount === ov.checklist.total;
  const claimDisabled = claim.isPending || ov.checklist.claimed || !allDone;
  /** 本页唯一的「当前命令」：开局任务未领完时是任务轨道，否则是剧情下一关 */
  const checklistLive = !ov.checklist.claimed && !allDone;
  const rep = ov.me.reputation;
  const nextTitle = nextReputationTitle(rep);
  const nextStage = ov.story.nextStage;
  const chapterCls = nextStage !== null && isTier(nextStage.chapter) ? TIER_TEXT[nextStage.chapter] : 'text-fg-muted';
  const feed = buildFeed(ov);

  function onClaim(): void {
    setClaimMsg(null);
    claim.mutate(undefined, {
      onSuccess: (r) =>
        setClaimMsg(
          r.already
            ? '该徽章此前已入档，无需重复领取。'
            : `领取成功，${CHECKLIST_BADGE_LABEL[r.badge] ?? '徽章'}已入档。`,
        ),
    });
  }

  return (
    <div className="space-y-5" data-testid="overview-page">
      <PageHeader
        eyebrow="教练台"
        title="欢迎回来，教练"
        description={`${reputationTitle(rep)} · 在营 ${ov.students.total} 名学员 · 候选池 ${ov.pool.count} 人待选`}
        actions={
          <>
            <ActionLink to="/academy">招募学员</ActionLink>
            <ActionLink to="/training" variant="ghost">
              训练中心
            </ActionLink>
          </>
        }
      />

      {/* 资源条：常驻遥测的次级刻度（主命令面留给下方唯一的 live 块） */}
      <section
        data-testid="overview-wallet"
        className="panel flex flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-2.5"
      >
        <WalletTick icon={GLYPH.money} tone="text-cyber-300">
          <span className="eyebrow">金币</span>{' '}
          <RollingNumber value={ov.me.money} className="numeral text-sm text-fg" />
        </WalletTick>
        <WalletTick icon={GLYPH.reputation} tone="text-arc-300">
          <span className="eyebrow">声誉</span>{' '}
          <RollingNumber value={ov.me.reputation} className="numeral text-sm text-fg" />
          <span className="text-[11px] text-fg-dim">
            {reputationTitle(rep)}
            {nextTitle !== null ? ` · 距${nextTitle.label} 还差 ${nextTitle.gap}` : ' · 已至顶阶'}
          </span>
        </WalletTick>
        <WalletTick icon={GLYPH.student} tone="text-fg-muted">
          <span className="eyebrow">在营学员</span>{' '}
          <span className="numeral text-sm text-fg">{ov.students.total}</span>
          <span className="text-[11px] text-fg-dim">
            · 剧情已通关 {ov.story.clearedStages}/{ov.story.totalStages} 关
          </span>
        </WalletTick>
        <WalletTick icon={RefreshCw} tone="text-warn-400">
          <span className="eyebrow">候选池</span>{' '}
          <span className="numeral text-sm text-fg">{ov.pool.count}</span>
          <span className="flex items-center gap-1 text-[11px] text-fg-dim">
            · 免费刷新 <PoolCountdown targetIso={ov.pool.freeRefreshAt} />
          </span>
        </WalletTick>
      </section>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          <Panel
            title="开局任务"
            eyebrow="开局"
            corners={checklistLive}
            actions={
              <span className="flex items-baseline gap-2">
                <span className="eyebrow">进度</span>
                <span data-testid="checklist-progress" className="numeral text-lg text-fg">
                  {ov.checklist.doneCount}/{ov.checklist.total}
                </span>
              </span>
            }
          >
            <ol className="space-y-0">
              {ov.checklist.steps.map((step) => (
                <ChecklistRow key={step.id} step={step} />
              ))}
            </ol>
            <div className="mt-4 border-t border-ink-600/60 pt-3">
              {ov.checklist.claimed ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                  已领取：
                  <span className="font-mono text-fg">{ov.checklist.rewardBadge}</span>
                  <Chip className="border-good-400/50 text-good-400">
                    {CHECKLIST_BADGE_LABEL[ov.checklist.rewardBadge] ?? '已完成'}
                  </Chip>
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Btn
                    data-testid="checklist-claim"
                    variant="primary"
                    disabled={claimDisabled}
                    onClick={onClaim}
                  >
                    {claim.isPending ? '领取中…' : '领取徽章'}
                  </Btn>
                  <Chip>{CHECKLIST_BADGE_LABEL[ov.checklist.rewardBadge] ?? ov.checklist.rewardBadge}</Chip>
                  {!allDone && (
                    <span className="text-xs text-fg-faint">
                      完成全部 5 项任务后可领取
                    </span>
                  )}
                </div>
              )}
              {claimMsg !== null && <p className="mt-2 text-sm text-good-400">{claimMsg}</p>}
              {claim.isError && (
                <p className="mt-2 text-sm text-bad-400">领取失败：{apiErrorMessage(claim.error)}</p>
              )}
            </div>
          </Panel>

          <Panel
            title="最近动态"
            eyebrow="动态"
            actions={<span className="text-[11px] text-fg-faint">训练 · 讲课 · 历练 · 赛事</span>}
          >
            {feed.length === 0 ? (
              <Empty
                icon={Dumbbell}
                title="还没有训练动态"
                action={<ActionLink to="/training">去训练中心</ActionLink>}
              >
                完成一次训练、讲课、历练或比赛后在此汇总。
              </Empty>
            ) : (
              <ol>
                {feed.map((item) => (
                  <li
                    key={item.key}
                    className="relative flex gap-3 pb-4 before:absolute before:top-8 before:left-[13px] before:h-[calc(100%-2.25rem)] before:w-px before:bg-ink-600/70 last:pb-0 last:before:hidden"
                  >
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center border border-ink-600 bg-ink-850 text-fg-dim">
                      <Icon icon={item.icon} className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link to={item.to} className="truncate text-sm text-fg transition-colors hover:text-cyber-300">
                          {item.title}
                        </Link>
                        <span
                          className="shrink-0 font-mono text-[11px] text-fg-faint"
                          title={new Date(item.at).toLocaleString()}
                        >
                          {relTime(item.at)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-fg-dim">{item.meta}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-5 xl:col-span-4">
          <Panel
            title={`我的学员（${ov.students.total}）`}
            eyebrow="名册"
            bodyClassName="p-0"
            actions={
              <Link to="/students" className="text-xs text-fg-dim transition-colors hover:text-cyber-300">
                全部学员
              </Link>
            }
          >
            {ov.students.items.length === 0 ? (
              <div className="p-4">
                <Empty
                  icon={Users}
                  title="还没有学员"
                  action={<ActionLink to="/academy">前往高级学院招募</ActionLink>}
                >
                  招募第一批学员，从 CSP-J 起步。
                </Empty>
              </div>
            ) : (
              <ul className="divide-y divide-ink-600/60">
                {ov.students.items.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <HoverCard content={<StudentHover s={s} defs={defs} />} width="w-80">
                      <Link
                        to={`/students/${s.id}`}
                        className="flex min-w-0 items-center gap-2 text-sm text-fg transition-colors hover:text-cyber-300"
                      >
                        <Icon icon={GLYPH.student} className="size-3.5 shrink-0 text-fg-faint" />
                        <span className="truncate">{s.name}</span>
                      </Link>
                    </HoverCard>
                    <span className="flex shrink-0 items-center gap-2">
                      <QualityBadge tier={s.qualityTier} />
                      <span className="font-mono text-xs text-fg-dim">V {floor(s.v)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="招募池"
            eyebrow="招募"
            actions={
              <Link to="/academy" className="text-xs text-fg-dim transition-colors hover:text-cyber-300">
                去招募
              </Link>
            }
          >
            <p className="text-fg-muted">
              <span className="eyebrow mr-2">当前候选</span>{' '}
              <Numeral value={ov.pool.count} className="text-2xl text-fg" />
              <span className="text-sm text-fg-dim"> 人</span>
            </p>
            <dl className="mt-3 space-y-1.5 border-t border-ink-600/60 pt-3">
              <div className="flex items-center justify-between text-xs">
                <dt className="text-fg-dim">手动刷新价格</dt>
                <dd className="font-mono text-fg">{ov.pool.refreshPrice} 金/次</dd>
              </div>
              <div className="flex items-center justify-between text-xs">
                <dt className="text-fg-dim">免费刷新</dt>
                <dd>
                  <PoolCountdown targetIso={ov.pool.freeRefreshAt} />
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel
            title="剧情进度"
            eyebrow="剧情"
            actions={
              <Link to="/story" className="text-xs text-fg-dim transition-colors hover:text-cyber-300">
                剧情模式
              </Link>
            }
          >
            <p className="text-fg-muted">
              <span className="eyebrow mr-2">已通关</span>{' '}
              <Numeral value={ov.story.clearedStages} className="text-2xl text-fg" />
              <span className="ml-1 text-sm text-fg-dim">/ {ov.story.totalStages} 关</span>
            </p>
            <Meter
              value={ov.story.clearedStages}
              max={ov.story.totalStages}
              className="mt-2 bg-cyber-400/70"
            />
            {nextStage !== null ? (
              <Link
                to="/story"
                className={`relative mt-3 flex items-center justify-between gap-3 border border-ink-600 bg-ink-850/50 px-3 py-2.5 transition-colors hover:border-cyber-400/50 ${
                  checklistLive ? '' : 'panel-corners'
                }`}
              >
                <span className="min-w-0">
                  <span className="eyebrow">下一关</span>
                  <span className="mt-0.5 block truncate text-sm text-fg">
                    <span className={`mr-1.5 font-mono ${chapterCls}`}>{tierLabel(nextStage.chapter)}</span>
                    {nextStage.name}
                  </span>
                </span>
                <Icon icon={ChevronRight} className="size-4 shrink-0 text-fg-faint" />
              </Link>
            ) : (
              <p className="mt-3 text-sm text-fg-faint">全部关卡已通关，等待新章节开放。</p>
            )}
          </Panel>

          <Panel title="公告板" eyebrow="公告" bodyClassName="divide-y divide-ink-600/60 p-0">
            {ov.announcements.length === 0 ? (
              <p className="px-4 py-5 text-sm text-fg-faint">暂无公告。</p>
            ) : (
              ov.announcements.map((a) => (
                <article key={a.id} className="flex gap-2 px-4 py-3">
                  <Icon icon={Megaphone} className="mt-0.5 size-3.5 shrink-0 text-cyber-300" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-fg">{a.title}</h3>
                    <p className="mt-1 text-xs text-fg-muted">{a.body}</p>
                    <p className="mt-1 font-mono text-[11px] text-fg-faint">{fmtStamp(Date.parse(a.createdAt))}</p>
                  </div>
                </article>
              ))
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 资源条 / 任务轨道 / 时间线
// ---------------------------------------------------------------------------

/** 资源刻度：一行小号数字 + eyebrow，不再与 sticky HUD 争主命令面 */
function WalletTick({
  icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon icon={icon} className={`size-3.5 shrink-0 ${tone}`} />
      {children}
    </span>
  );
}

const STEP_ICON: Record<ChecklistStepId, LucideIcon> = {
  train: Dumbbell,
  lecture: Presentation,
  adventure: Compass,
  story: ScrollText,
  recruit3: GraduationCap,
};

const STEP_ROUTE: Record<ChecklistStepId, string> = {
  train: '/training',
  lecture: '/academy/lecture',
  adventure: '/adventure',
  story: '/story',
  recruit3: '/academy',
};

function ChecklistRow({ step }: { step: OverviewView['checklist']['steps'][number] }): JSX.Element {
  return (
    <li className="relative flex gap-3 pb-4 before:absolute before:top-8 before:left-[13px] before:h-[calc(100%-2.25rem)] before:w-px before:bg-ink-600/70 last:pb-0 last:before:hidden">
      <span
        className={`mt-0.5 grid size-7 shrink-0 place-items-center border ${
          step.done
            ? 'border-cyber-400/60 bg-cyber-400/10 text-cyber-300'
            : 'border-ink-500 bg-ink-850 text-fg-faint'
        }`}
      >
        <Icon icon={step.done ? CircleCheck : STEP_ICON[step.id]} className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className={`text-sm ${step.done ? 'text-fg-dim line-through' : 'font-medium text-fg'}`}>
          {step.label}
        </p>
        <p className="mt-0.5 text-xs">
          {step.done ? (
            <span className="text-fg-faint">已完成</span>
          ) : (
            <Link
              to={STEP_ROUTE[step.id]}
              className="inline-flex items-center gap-0.5 text-fg-dim transition-colors hover:text-cyber-300"
            >
              {step.hint}
              <Icon icon={ChevronRight} className="size-3" />
            </Link>
          )}
        </p>
      </div>
    </li>
  );
}

function PoolCountdown({ targetIso }: { targetIso: string }): JSX.Element {
  const now = useNow();
  const ms = Date.parse(targetIso) - now;
  if (!Number.isFinite(ms)) return <span className="font-mono text-fg-faint">—</span>;
  if (ms <= 0) return <span className="text-good-400">已就绪</span>;
  const total = Math.floor(ms / 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const mm = pad(Math.floor((total % 3600) / 60));
  const ss = pad(total % 60);
  return <span className="font-mono text-fg">{hours > 0 ? `${pad(hours)}:${mm}:${ss}` : `${mm}:${ss}`}</span>;
}

interface FeedItem {
  key: string;
  at: number;
  icon: LucideIcon;
  title: string;
  meta: string;
  to: string;
}

/** 四类近期记录合成一条时间线（服务端每类至多 5 条，倒序取前 12）。 */
function buildFeed(ov: OverviewView): FeedItem[] {
  const items: FeedItem[] = [
    ...ov.recent.training.map((t) => ({
      key: `train-${t.id}`,
      at: Date.parse(t.createdAt),
      icon: DIMENSION_ICON[t.dim] ?? Dumbbell,
      title: `${t.studentName} · ${TRAINING_KIND_LABEL[t.kind] ?? '训练'}`,
      meta: `${DIMENSION_LABEL[t.dim] ?? '能力'} ${signed(t.delta)}`,
      to: '/training',
    })),
    ...ov.recent.lectures.map((l) => ({
      key: `lecture-${l.id}`,
      at: Date.parse(l.createdAt),
      icon: Presentation,
      title: l.success ? '讲课成功' : '讲课未达预期',
      meta: `${lectureTierLabel(l.tier)} · ${l.money >= 0 ? '+' : ''}${l.money} 金 · 声誉 ${
        l.reputation >= 0 ? '+' : ''
      }${l.reputation}`,
      to: '/academy/lecture',
    })),
    ...ov.recent.adventures.map((a) => ({
      key: `adventure-${a.id}`,
      at: Date.parse(a.createdAt),
      icon: eventCategoryIcon(a.event.category),
      title: a.event.name,
      meta: `${eventCategoryLabel(a.event.category)} · ${ADVENTURE_STATUS_LABEL[a.status] ?? '已结算'}`,
      to: '/adventure',
    })),
    ...ov.recent.contests.map((c) => ({
      key: `contest-${c.id}`,
      at: Date.parse(c.createdAt),
      icon: Trophy,
      title: `${(CONTEST_RECORD_TYPE_LABEL as Record<string, string>)[c.type] ?? '对局'} · ${
        (CONTEST_FORMAT_LABEL as Record<string, string>)[c.format] ?? '赛制未知'
      }`,
      meta: stageMeta(c.stageKey),
      to: `/records/${c.id}`,
    })),
  ];
  return items.sort((a, b) => b.at - a.at).slice(0, 12);
}

function stageMeta(stageKey: string | null): string {
  const [chapter, index] = (stageKey ?? '').split(':');
  if (chapter === undefined || chapter === '' || index === undefined) return '完整战报可回看';
  return `${tierLabel(chapter)} 第 ${index} 关 · 完整战报可回看`;
}

function relTime(at: number): string {
  const diff = Date.now() - at;
  if (!Number.isFinite(diff)) return '—';
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return fmtStamp(at);
}

function fmtStamp(at: number): string {
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
