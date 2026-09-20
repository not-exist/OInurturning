import { useState, type JSX, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { CircleCheck, Gift, Lock, Target, Users } from 'lucide-react';
import type { StoryStageProgress } from '@oinur/shared';
import { apiErrorMessage } from '../../lib/api';
import { BattleReplay, BattleWaiting } from '../records/BattleReplay';
import {
  useEnterStoryStage,
  useStoryOverview,
  useStudents,
  type StoryEntryResult,
} from '../../lib/hooks';
import { tierLabel } from '../../lib/labels';
import { TIER_TEXT, isTier } from '../../lib/rarity';
import { Icon, NAV_ICON, type LucideIcon } from '../../components/icons';
import {
  Btn,
  Chip,
  Empty,
  ErrorNote,
  HoverCard,
  InlineLoader,
  Meter,
  PageHeader,
  Panel,
} from '../../components/ui';
import { RosterPicker } from '../../components/RosterPicker';

const ROSTER_SIZE = 4;

function ngLabel(layer: number): string {
  return layer === 0 ? '一周目' : `NG+ ${layer}`;
}

/** `cspj:1` →「CSP-J 第 1 关」；解析失败时退回「第 n 关」，不把裸 id 打到可见文案。 */
function stageNumberLabel(stageKey: string, ordinal: number): string {
  const sep = stageKey.lastIndexOf(':');
  const tier = sep === -1 ? '' : stageKey.slice(0, sep);
  const parsed = sep === -1 ? Number.NaN : Number(stageKey.slice(sep + 1));
  const index = Number.isInteger(parsed) && parsed > 0 ? parsed : ordinal;
  return isTier(tier) ? `${tierLabel(tier)} 第 ${index} 关` : `第 ${index} 关`;
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

/**
 * 语义色标签：Chip 的默认描边/文字色在同名工具类中排序靠后（ink < cyber/good），
 * 会盖掉传入的语义色，故状态标签用不含默认色的本组件。
 */
function ToneChip({
  className,
  icon,
  children,
}: {
  className: string;
  icon?: LucideIcon;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 border bg-ink-800/40 px-1.5 py-0.5 text-[11px] ${className}`}
    >
      {icon !== undefined && <Icon icon={icon} className="size-3" />}
      {children}
    </span>
  );
}

function StageNode({
  stage,
  ordinal,
  staminaShort,
  rosterReady,
  rosterSize,
  pending,
  onEnter,
}: {
  stage: StoryStageProgress;
  ordinal: number;
  staminaShort: boolean;
  rosterReady: boolean;
  rosterSize: number;
  pending: boolean;
  onEnter: () => void;
}): JSX.Element {
  const cost = stage.staminaCost ?? 0;
  const name = stage.name ?? '未知关卡';
  const blocked = !stage.unlocked
    ? '未解锁'
    : !rosterReady
      ? `需选满 ${rosterSize} 人`
      : staminaShort
        ? '体力不足'
        : null;
  const StateIcon = stage.cleared ? CircleCheck : stage.unlocked ? Target : Lock;
  const state = stage.cleared ? 'cleared' : stage.unlocked ? 'open' : 'locked';

  return (
    <li
      className={`relative mb-1.5 flex flex-wrap items-center gap-4 py-3 pr-3 pl-11 last:mb-0 ${
        state === 'cleared'
          ? 'border border-good-400/25 bg-good-400/[0.06]'
          : state === 'open'
            ? 'border border-cyber-400/40 bg-cyber-400/[0.08]'
            : 'border border-ink-600/50 bg-ink-900/55'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-0 bottom-0 left-[1.125rem] w-px ${
          state === 'cleared'
            ? 'bg-good-400/35'
            : state === 'open'
              ? 'bg-cyber-400/40'
              : 'bg-ink-600/50'
        }`}
      />
      <span
        className={`absolute left-2 flex size-6 items-center justify-center border bg-ink-900 ${
          state === 'cleared'
            ? 'border-good-400/70 text-good-400'
            : state === 'open'
              ? 'border-cyber-400/70 text-cyber-300'
              : 'border-ink-600 text-fg-faint'
        }`}
      >
        <Icon icon={StateIcon} className="size-3.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={`font-mono text-[11px] ${
              state === 'open' ? 'text-cyber-400' : state === 'cleared' ? 'text-good-400/80' : 'text-fg-faint'
            }`}
          >
            {String(ordinal).padStart(2, '0')}
          </span>
          <HoverCard
            width="w-80"
            content={
              <span className="block space-y-1.5">
                <span className="block text-xs font-semibold text-fg">
                  {name}
                </span>
                <HoverRow k="关卡编号">{stageNumberLabel(stage.stageKey, ordinal)}</HoverRow>
                <HoverRow k="推荐等级">{stage.recommendedLevel ?? '—'}</HoverRow>
                <HoverRow k="比赛时长">{stage.durationMin ?? '—'} 分钟</HoverRow>
                <HoverRow k="体力消耗">×{cost}</HoverRow>
                <HoverRow k="出战人数">{rosterSize} 人</HoverRow>
                <HoverRow k="首通奖励">{stage.firstClearAt === null ? '待领取' : '已领取'}</HoverRow>
                <HoverRow k="最佳名次">{stage.bestRank ?? '—'}</HoverRow>
                <HoverRow k="通关次数">{stage.clearCount}</HoverRow>
                <span className="block pt-1 text-[11px] text-fg-dim">
                  {stage.unlocked
                    ? '通关后在名次达标时解锁下一关。'
                    : '尚未解锁：先通关上一关。'}
                </span>
              </span>
            }
          >
            <span
              className={`cursor-help font-medium ${
                state === 'open' ? 'text-fg' : state === 'cleared' ? 'text-fg-muted' : 'text-fg-faint'
              }`}
            >
              {name}
            </span>
          </HoverCard>
          {stage.cleared && (
            <ToneChip className="border-good-400/50 bg-good-400/10 text-good-400">
              已通关{stage.bestRank === null ? '' : ` · 最佳名次 ${stage.bestRank}`}
            </ToneChip>
          )}
          {!stage.cleared && stage.firstClearAt === null && stage.unlocked && (
            <ToneChip icon={Gift} className="border-cyber-400/50 bg-cyber-400/10 text-cyber-300">
              首通奖励待领取
            </ToneChip>
          )}
          {blocked === '未解锁' && <Chip icon={Lock}>未解锁</Chip>}
        </span>
        <span
          className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${
            state === 'open' ? 'text-fg-dim' : 'text-fg-faint'
          }`}
        >
          <span>推荐等级 {stage.recommendedLevel ?? '—'}</span>
          <span>{stage.durationMin ?? '—'} 分钟</span>
          <span>{rosterSize} 人团体赛</span>
          <span className={state === 'locked' ? 'text-fg-faint' : 'text-warn-400'}>体力 ×{cost}</span>
          {stage.clearCount > 0 && <span>已通关 {stage.clearCount} 次</span>}
        </span>
      </span>

      <span className="flex items-center gap-2">
        {blocked !== null && blocked !== '未解锁' && (
          <span className="text-[11px] text-fg-faint">{blocked}</span>
        )}
        <Btn
          variant={stage.unlocked ? 'primary' : 'ghost'}
          size="sm"
          data-testid="story-enter"
          disabled={blocked !== null || pending}
          onClick={onEnter}
        >
          进入
        </Btn>
      </span>
    </li>
  );
}

export function StoryPage(): JSX.Element {
  const [ngLevel, setNgLevel] = useState(0);
  const [roster, setRoster] = useState<number[]>([]);
  const overview = useStoryOverview(ngLevel);
  const students = useStudents();
  const enter = useEnterStoryStage();
  const navigate = useNavigate();
  const [battleReplay, setBattleReplay] = useState<StoryEntryResult['replay']>();

  if (overview.isPending || students.isPending) {
    return <InlineLoader>正在读取剧情赛程…</InlineLoader>;
  }
  if (overview.isError || students.isError) {
    return (
      <ErrorNote
        onRetry={() => {
          void overview.refetch();
          void students.refetch();
        }}
      >
        剧情进度读取失败：{apiErrorMessage(overview.error ?? students.error)}
      </ErrorNote>
    );
  }
  if (overview.data === undefined || students.data === undefined) return <></>;

  if (enter.isPending) {
    return <BattleWaiting label="服务端正在完成比赛模拟并传回回放…" />;
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

  const rosterReady = roster.length === ROSTER_SIZE;
  const rosterById = new Map(students.data.map((student) => [student.id, student]));
  const totalStages = overview.data.chapters.reduce(
    (sum, chapter) => sum + chapter.stages.length,
    0,
  );
  const clearedStages = overview.data.chapters.reduce(
    (sum, chapter) => sum + chapter.stages.filter((stage) => stage.cleared).length,
    0,
  );

  const enterStage = (stageKey: string): void => {
    if (!rosterReady) return;
    enter.mutate(
      { stageKey, roster, ngLevel, idempotencyKey: crypto.randomUUID() },
      { onSuccess: (result) => setBattleReplay(result.replay) },
    );
  };

  return (
    <div data-testid="story-page" className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow="赛程"
        title="剧情模式"
        description="八个赛季阶梯，33 关赛事。每关 4 人团体赛，名次达标即推进。"
        actions={
          overview.data.ngPlusUnlocked ? (
            <div className="flex items-center gap-1.5">
              <span className="eyebrow">挑战层</span>
              {Array.from({ length: overview.data.maxUnlockedNgLevel + 1 }, (_, layer) => (
                <button
                  key={layer}
                  type="button"
                  data-testid={`story-ng-${layer}`}
                  aria-pressed={ngLevel === layer}
                  className={`border px-2.5 py-1 text-xs transition-colors ${
                    ngLevel === layer
                      ? 'border-cyber-400/70 bg-cyber-400/15 text-cyber-300'
                      : 'border-ink-600 bg-ink-800/40 text-fg-dim hover:border-ink-500 hover:text-fg'
                  }`}
                  onClick={() => setNgLevel(layer)}
                >
                  {ngLabel(layer)}
                </button>
              ))}
            </div>
          ) : (
            <Chip icon={Lock}>通关八章后解锁 NG+</Chip>
          )
        }
      />

      <Panel
        eyebrow="阵容"
        title="出战阵容"
        corners
        actions={
          <span className="text-xs text-fg-dim">
            已通关 {clearedStages}/{totalStages} 关
          </span>
        }
      >
        <RosterPicker
          students={students.data}
          selectedIds={roster}
          min={ROSTER_SIZE}
          max={ROSTER_SIZE}
          onChange={setRoster}
          dataTestIdPrefix="story-roster"
        />
        <p className="mt-3 text-[11px] text-fg-dim">
          4 人团体排名赛：全队每关各消耗固定体力，名次进入前 8 视为通关。
        </p>
        {enter.isError && (
          <div className="mt-3">
            <ErrorNote>
              <span data-testid="story-error">
                进入关卡失败：{apiErrorMessage(enter.error)}（解锁状态、体力与阵容均需满足）
              </span>
            </ErrorNote>
          </div>
        )}
      </Panel>

      {students.data.length < ROSTER_SIZE && (
        <Empty
          icon={Users}
          title={`至少需要 ${ROSTER_SIZE} 名学员出战`}
          action={
            <Btn variant="primary" onClick={() => navigate('/academy')}>
              前往高级学院招募
            </Btn>
          }
        >
          剧情关卡为 4 人团体赛，招募满 4 名学员才能踏上 CSP-J 的赛场。
        </Empty>
      )}

      <div className="space-y-5">
        {overview.data.chapters.map((chapter, chapterIndex) => {
          const cleared = chapter.stages.filter((stage) => stage.cleared).length;
          const tier = isTier(chapter.chapter) ? TIER_TEXT[chapter.chapter] : 'text-fg';
          return (
            <Panel
              key={chapter.chapter}
              bodyClassName="p-2 sm:p-4"
              className="animate-rise"
              title={
                <span className="flex items-center gap-2">
                  <span className={`font-display text-base ${tier}`}>
                    {tierLabel(chapter.chapter)}
                  </span>
                  <span className="text-[11px] font-normal text-fg-faint">
                    第 {chapterIndex + 1} 章
                  </span>
                </span>
              }
              actions={
                <span className="flex items-center gap-3">
                  <span className="tnum text-[11px] text-fg-dim">
                    {cleared}/{chapter.stages.length}
                  </span>
                  <span className="hidden w-24 sm:block">
                    <Meter
                      value={cleared}
                      max={chapter.stages.length}
                      className={cleared === chapter.stages.length ? 'bg-good-400' : 'bg-cyber-400'}
                    />
                  </span>
                </span>
              }
            >
              <ol className="relative">
                {chapter.stages.map((stage, stageIndex) => (
                  <StageNode
                    key={stage.stageKey}
                    stage={stage}
                    ordinal={stageIndex + 1}
                    rosterSize={ROSTER_SIZE}
                    rosterReady={rosterReady}
                    staminaShort={roster.some(
                      (id) => (rosterById.get(id)?.stamina ?? 0) < (stage.staminaCost ?? 0),
                    )}
                    pending={enter.isPending}
                    onEnter={() => enterStage(stage.stageKey)}
                  />
                ))}
              </ol>
            </Panel>
          );
        })}
      </div>

      <p className="flex items-center gap-1.5 border-t border-ink-600/60 pt-4 text-[11px] text-fg-dim">
        <Icon icon={NAV_ICON.story} className="size-3.5" />
        NG+ 各层关卡独立结算：首通奖励按层发放，战报随时可从对应赛事记录回看。
      </p>
    </div>
  );
}
