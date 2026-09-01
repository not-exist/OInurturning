import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useEnterStoryStage, useStoryOverview, useStudents } from '../../lib/hooks';

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
  const [studentId, setStudentId] = useState<number>();
  const overview = useStoryOverview(ngLevel);
  const students = useStudents();
  const enter = useEnterStoryStage();
  const navigate = useNavigate();

  if (overview.isPending || students.isPending)
    return <p className="text-neutral-500">加载剧情进度…</p>;
  if (overview.isError || students.isError)
    return <p className="text-red-600">剧情数据加载失败，请稍后重试。</p>;
  if (overview.data === undefined || students.data === undefined) return null;

  const activeStudentId = studentId ?? students.data[0]?.id;
  const enterStage = (stageKey: string) => {
    if (activeStudentId === undefined) return;
    enter.mutate(
      {
        stageKey,
        roster: [activeStudentId],
        ngLevel,
        idempotencyKey: crypto.randomUUID(),
      },
      { onSuccess: (result) => navigate(`/records/${result.record.id}`) },
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

      <div className="flex flex-wrap items-center gap-3 border-b pb-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">出战学员</span>
          <select
            className="rounded border border-neutral-300 bg-white px-3 py-2"
            value={activeStudentId ?? ''}
            onChange={(event) => setStudentId(Number(event.target.value))}
          >
            {students.data.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name} · V{student.v} · 精力 {Math.floor(student.energy)}
              </option>
            ))}
          </select>
        </label>
        {students.data.length === 0 && (
          <span className="text-sm text-amber-700">暂无可出战学员</span>
        )}
        {enter.isError && (
          <span className="text-sm text-red-600">进入关卡失败，请检查解锁状态与资源。</span>
        )}
      </div>

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
                    disabled={!stage.unlocked || activeStudentId === undefined || enter.isPending}
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
