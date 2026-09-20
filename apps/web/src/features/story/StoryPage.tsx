import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiErrorMessage } from '../../lib/api';
import { BattleReplay, BattleWaiting } from '../records/BattleReplay';
import {
  useEnterStoryStage,
  useStoryOverview,
  useStudents,
  type StoryEntryResult,
} from '../../lib/hooks';
import { Empty } from '../../components/ui';
import { RosterPicker } from '../../components/RosterPicker';

const ROSTER_SIZE = 4;

const CHAPTER_LABEL: Record<string, string> = {
  cspj: 'CSP-J',
  csps: 'CSP-S',
  noip: 'NOIP',
  province: '省选',
  noi: 'NOI',
  ctt: 'CTT',
  cts: 'CTS',
  ioi: 'IOI',
};

export function StoryPage() {
  const [ngLevel, setNgLevel] = useState(0);
  const [roster, setRoster] = useState<number[]>([]);
  const overview = useStoryOverview(ngLevel);
  const students = useStudents();
  const enter = useEnterStoryStage();
  const navigate = useNavigate();
  const [battleReplay, setBattleReplay] = useState<StoryEntryResult['replay']>();

  if (overview.isPending || students.isPending)
    return (
      <div className="flex items-center gap-2 text-neutral-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
        加载剧情进度…
      </div>
    );
  if (overview.isError || students.isError) {
    return (
      <div className="space-y-2 text-sm text-red-600">
        <p>剧情数据加载失败：{apiErrorMessage(overview.error ?? students.error)}</p>
        <button
          className="rounded border px-3 py-1 text-xs"
          onClick={() => {
            void overview.refetch();
            void students.refetch();
          }}
        >
          重试
        </button>
      </div>
    );
  }
  if (overview.data === undefined || students.data === undefined) return null;

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
  const enterStage = (stageKey: string) => {
    if (!rosterReady) return;
    enter.mutate(
      {
        stageKey,
        roster,
        ngLevel,
        idempotencyKey: crypto.randomUUID(),
      },
      { onSuccess: (result) => setBattleReplay(result.replay) },
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
            Contest Circuit
          </p>
          <h1 className="mt-1 text-2xl font-semibold">剧情模式</h1>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">挑战层</span>
          <select
            data-testid="story-ng"
            className="rounded border border-neutral-300 bg-white px-3 py-2"
            value={ngLevel}
            onChange={(event) => setNgLevel(Number(event.target.value))}
          >
            {Array.from({ length: overview.data.maxUnlockedNgLevel + 1 }, (_, layer) => (
              <option key={layer} value={layer}>
                {layer === 0 ? '一周目' : `NG+ ${layer}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="border-b pb-4">
        <RosterPicker
          students={students.data}
          selectedIds={roster}
          min={ROSTER_SIZE}
          max={ROSTER_SIZE}
          onChange={setRoster}
          dataTestIdPrefix="story-roster"
        />
        {enter.isError && (
          <span data-testid="story-error" className="mt-3 block text-sm text-red-600">
            进入关卡失败：{apiErrorMessage(enter.error)}（解锁、体力与精力均需满足）
          </span>
        )}
      </div>

      {students.data.length < ROSTER_SIZE && (
        <Empty
          title="至少需要 4 名学员出战"
          action={
            <Link
              to="/academy"
              className="inline-block rounded bg-neutral-900 px-4 py-2 text-sm text-white"
            >
              前往高级学院招募
            </Link>
          }
        >
          剧情关卡为 4 人团体赛，招募满 4 名学员才能踏上 CSP-J 的赛场。
        </Empty>
      )}

      <div className="space-y-8">
        {overview.data.chapters.map((chapter) => (
          <section key={chapter.chapter}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">
                {CHAPTER_LABEL[chapter.chapter] ?? chapter.chapter}
              </h2>
              <span className="text-xs text-neutral-500">
                {chapter.stages.filter((stage) => stage.cleared).length}/{chapter.stages.length}{' '}
                已通关
              </span>
            </div>
            <div className="overflow-hidden rounded border border-neutral-200 bg-white">
              {chapter.stages.map((stage) => (
                <div
                  key={stage.stageKey}
                  className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-44 flex-1">
                    <p className="font-medium">{stage.name ?? stage.stageKey}</p>
                    <p className="text-xs text-neutral-500">
                      {stage.stageKey} · 推荐 {stage.recommendedLevel ?? '-'} ·{' '}
                      {stage.durationMin ?? '-'} 分钟 · 体力 {stage.staminaCost ?? '-'}
                    </p>
                  </div>
                  <span
                    className={
                      stage.cleared
                        ? 'text-sm text-green-700'
                        : stage.unlocked
                          ? 'text-sm text-blue-700'
                          : 'text-sm text-neutral-400'
                    }
                  >
                    {stage.cleared
                      ? `已通关 · 最佳 ${stage.bestRank ?? '-'}`
                      : stage.unlocked
                        ? '可挑战'
                        : '未解锁'}
                  </span>
                  <button
                    type="button"
                    className="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
                    data-testid="story-enter"
                    disabled={!stage.unlocked || !rosterReady || enter.isPending}
                    onClick={() => enterStage(stage.stageKey)}
                  >
                    {enter.isPending ? '结算中…' : '进入'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
