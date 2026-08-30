import { Link } from 'react-router';
import type { JSX } from 'react';
import type { DimensionKey, StudentView } from '@oinur/shared';
import { DIMENSION_LABEL, QUALITY_LABEL, floor, round, useStudents } from '../../lib/hooks';

const DIMS: Record<DimensionKey, keyof StudentView> = {
  DS: 'ds',
  DP: 'dp',
  MATH: 'math',
  GRAPH: 'graph',
  GREEDY: 'greedy',
  STRING: 'str',
};

function StatBar({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 shrink-0 text-neutral-500">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-200">
        <div
          className="h-full bg-neutral-800"
          style={{ width: `${Math.min(100, Math.max(0, floor(value)))}%` }}
        />
      </div>
      <span className="w-6 text-right tabular-nums">{floor(value)}</span>
    </div>
  );
}

export function StudentsPage(): JSX.Element {
  const q = useStudents();

  if (q.isLoading) return <p className="text-neutral-500">加载中…</p>;
  if (q.isError || !q.data) return <p className="text-red-600">加载失败</p>;
  const students = q.data;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">学员管理</h1>
      {students.length === 0 ? (
        <p className="text-neutral-500">暂无学员，请前往「高级学院」招募。</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {students.map((s) => (
            <StudentCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function StudentCard({ s }: { s: StudentView }): JSX.Element {
  return (
    <Link
      to={`/students/${s.id}`}
      className="block rounded border bg-white p-4 shadow-sm transition hover:shadow"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">{s.name}</span>
        <span className={`rounded px-2 py-0.5 text-xs ${rarityBadgeColor(s.qualityTier)}`}>
          {QUALITY_LABEL[s.qualityTier]}
        </span>
      </div>
      <p className="mb-2 text-xs text-neutral-500">V = {s.v}</p>
      <div className="space-y-1">
        {(Object.keys(DIMS) as DimensionKey[]).map((d) => (
          <StatBar key={d} label={DIMENSION_LABEL[d]} value={s[DIMS[d]] as number} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t pt-2 text-xs text-neutral-500">
        <span>心态 {round(s.mindset)}</span>
        <span>
          体力 {floor(s.stamina)}/{5} · 精力 {floor(s.energy)}/{s.energyMax}
        </span>
      </div>
    </Link>
  );
}

function rarityBadgeColor(t: StudentView['qualityTier']): string {
  // 品质档不属稀有度序列，这里用中性配色区分档位
  switch (t) {
    case 'COMMON':
      return 'bg-neutral-200 text-neutral-700';
    case 'GOOD':
      return 'bg-yellow-100 text-yellow-700';
    case 'ELITE':
      return 'bg-blue-100 text-blue-700';
    case 'GENIUS':
      return 'bg-purple-100 text-purple-700';
    default:
      return 'bg-neutral-200 text-neutral-700';
  }
}
