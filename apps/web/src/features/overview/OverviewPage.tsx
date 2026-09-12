import { useState, type JSX } from 'react';
import { Link } from 'react-router';
import { apiErrorMessage } from '../../lib/api';
import {
  DIMENSION_LABEL,
  QUALITY_LABEL,
  TRAINING_KIND_LABEL,
  floor,
  round,
  useClaimChecklist,
  useNow,
  useOverview,
} from '../../lib/hooks';
import type { ChecklistStepView } from '../../lib/hooks';
import { Empty, InlineLoader } from '../../components/ui';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function fmtCountdown(targetIso: string, now: number): string {
  const ms = new Date(targetIso).getTime() - now;
  if (ms <= 0) return '免费刷新已就绪';
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss} 后免费刷新`;
}

function roundDelta(v: number): number {
  return round(v * 100) / 100;
}

function StepRow({ step }: { step: ChecklistStepView }): JSX.Element {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span aria-hidden>{step.done ? '✅' : '⬜'}</span>
      <div>
        <p className={step.done ? 'text-neutral-500 line-through' : 'font-medium'}>{step.label}</p>
        <p className="text-xs text-neutral-500">{step.hint}</p>
      </div>
    </li>
  );
}

export function OverviewPage(): JSX.Element {
  const q = useOverview();
  const claim = useClaimChecklist();
  const now = useNow();
  const [claimMsg, setClaimMsg] = useState<string | null>(null);

  if (q.isLoading) return <InlineLoader>总览加载中…</InlineLoader>;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-2 text-sm text-red-600">
        <p>总览加载失败：{apiErrorMessage(q.error)}</p>
        <button className="rounded border px-3 py-1 text-xs" onClick={() => void q.refetch()}>
          重试
        </button>
      </div>
    );
  }
  const ov = q.data;
  const allDone = ov.checklist.doneCount === ov.checklist.total;
  const claimDisabled = claim.isPending || ov.checklist.claimed || !allDone;

  function onClaim(): void {
    setClaimMsg(null);
    claim.mutate(undefined, {
      onSuccess: (r) =>
        setClaimMsg(
          r.already ? `已经领取过啦，徽章：${r.badge}` : `领取成功！获得徽章：${r.badge}`,
        ),
    });
  }

  return (
    <div className="space-y-4" data-testid="overview-page">
      <div>
        <h1 className="text-xl font-bold">欢迎回来，教练</h1>
        <p className="mt-1 text-sm text-neutral-500" data-testid="overview-wallet">
          💰 金币 {ov.me.money} · ⭐ 声誉 {ov.me.reputation}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">开局任务</h2>
            <span className="text-xs text-neutral-500" data-testid="checklist-progress">
              {ov.checklist.doneCount}/{ov.checklist.total}
            </span>
          </div>
          <ul className="space-y-2">
            {ov.checklist.steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
          </ul>
          <div className="mt-3 border-t pt-3 text-sm">
            {ov.checklist.claimed ? (
              <p className="text-neutral-600">🎖️ 已领取：{ov.checklist.rewardBadge}</p>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  data-testid="checklist-claim"
                  className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
                  disabled={claimDisabled}
                  onClick={onClaim}
                >
                  {claim.isPending ? '领取中…' : `领取徽章（${ov.checklist.rewardBadge}）`}
                </button>
                {!allDone && <span className="text-xs text-neutral-500">完成全部任务后可领取</span>}
              </div>
            )}
            {claimMsg && <p className="mt-2 text-green-700">{claimMsg}</p>}
            {claim.isError && (
              <p className="mt-2 text-red-600">领取失败：{apiErrorMessage(claim.error)}</p>
            )}
          </div>
        </section>

        <section className="rounded border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">我的学员（{ov.students.total}）</h2>
            <Link to="/students" className="text-xs text-neutral-500 underline">
              全部学员 →
            </Link>
          </div>
          {ov.students.items.length === 0 ? (
            <Empty icon="🎓" title="还没有学员">
              去高级学院招募你的第一批学员吧。
            </Empty>
          ) : (
            <ul className="divide-y text-sm">
              {ov.students.items.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-1.5">
                  <Link to={`/students/${s.id}`} className="font-medium underline">
                    {s.name}
                  </Link>
                  <span className="text-xs text-neutral-500">
                    {QUALITY_LABEL[s.qualityTier]} · V{floor(s.v)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded border bg-white p-4">
          <h2 className="mb-2 font-semibold">剧情进度</h2>
          <p className="text-sm text-neutral-600">
            已通关 {ov.story.clearedStages}/{ov.story.totalStages} 关
          </p>
          {ov.story.nextStage ? (
            <p className="mt-1 text-sm">
              下一关：
              <Link
                to="/story"
                className="font-medium underline"
              >{`${ov.story.nextStage.chapter} · ${ov.story.nextStage.name}`}</Link>
            </p>
          ) : (
            <p className="mt-1 text-sm text-neutral-500">全部关卡已通关，敬请期待新章节。</p>
          )}
        </section>

        <section className="rounded border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">招募池</h2>
            <Link to="/academy" className="text-xs text-neutral-500 underline">
              去招募 →
            </Link>
          </div>
          <p className="text-sm text-neutral-600">
            当前候选 {ov.pool.count} 人 · 刷新 {ov.pool.refreshPrice} 金/次
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {fmtCountdown(ov.pool.freeRefreshAt, now)}
          </p>
        </section>
      </div>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">最近动态</h2>
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-medium text-neutral-500">
              训练{' '}
              <Link to="/training" className="underline">
                更多 →
              </Link>
            </h3>
            {ov.recent.training.length === 0 ? (
              <p className="text-xs text-neutral-400">暂无训练记录</p>
            ) : (
              <ul className="space-y-1">
                {ov.recent.training.map((t) => (
                  <li key={t.id} className="text-xs text-neutral-600">
                    {t.studentName} · {TRAINING_KIND_LABEL[t.kind]} · {DIMENSION_LABEL[t.dim]} +
                    {roundDelta(t.delta)} · {fmtTime(t.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-neutral-500">
              讲课{' '}
              <Link to="/academy/lecture" className="underline">
                更多 →
              </Link>
            </h3>
            {ov.recent.lectures.length === 0 ? (
              <p className="text-xs text-neutral-400">暂无讲课记录</p>
            ) : (
              <ul className="space-y-1">
                {ov.recent.lectures.map((l) => (
                  <li key={l.id} className="text-xs text-neutral-600">
                    {l.success ? '✅ 授课成功' : '❌ 授课失败'} · {l.money >= 0 ? '+' : ''}
                    {l.money} 金 · {fmtTime(l.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-neutral-500">
              历练{' '}
              <Link to="/adventure" className="underline">
                更多 →
              </Link>
            </h3>
            {ov.recent.adventures.length === 0 ? (
              <p className="text-xs text-neutral-400">暂无历练记录</p>
            ) : (
              <ul className="space-y-1">
                {ov.recent.adventures.map((a) => (
                  <li key={a.id} className="text-xs text-neutral-600">
                    {a.event.name} · {a.status === 'RESOLVED' ? '已结算' : '待处理'} ·{' '}
                    {fmtTime(a.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-neutral-500">比赛</h3>
            {ov.recent.contests.length === 0 ? (
              <p className="text-xs text-neutral-400">暂无比赛记录</p>
            ) : (
              <ul className="space-y-1">
                {ov.recent.contests.map((c) => (
                  <li key={c.id} className="text-xs text-neutral-600">
                    <Link to={`/records/${c.id}`} className="underline">
                      {c.type} · {c.format}
                    </Link>{' '}
                    · {fmtTime(c.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">公告</h2>
        {ov.announcements.length === 0 ? (
          <p className="text-sm text-neutral-400">暂无公告</p>
        ) : (
          <ul className="space-y-2">
            {ov.announcements.map((a) => (
              <li key={a.id} className="border-b pb-2 text-sm last:border-0 last:pb-0">
                <p className="font-medium">{a.title}</p>
                <p className="mt-0.5 text-xs text-neutral-600">{a.body}</p>
                <p className="mt-0.5 text-xs text-neutral-400">{fmtTime(a.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
