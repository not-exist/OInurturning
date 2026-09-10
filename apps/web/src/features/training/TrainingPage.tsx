import { useState, type JSX } from 'react';
import { Link } from 'react-router';
import type { DimensionKey, StudentView } from '@oinur/shared';
import { apiErrorMessage } from '../../lib/api';
import {
  DIMENSION_LABEL,
  QUALITY_LABEL,
  floor,
  rarityBadge,
  rarityText,
  round,
  useBasicTrain,
  useDirectedTrain,
  useInventory,
  useProblems,
  useSpecializedTrain,
  useStudents,
} from '../../lib/hooks';
import type { ProblemView, RareGain, TrainingResult } from '../../lib/hooks';
import { Empty } from '../../components/ui';

type Tab = 'basic' | 'directed' | 'specialized';

/** 六维 → 六维书 subject 键（定向训练耗材；与 training DIM_META 一致） */
const DIM_BOOK_SUBJECT: Record<DimensionKey, string> = {
  DS: 'ds',
  DP: 'dp',
  MATH: 'math',
  GRAPH: 'graph',
  GREEDY: 'greedy',
  STRING: 'string',
};

const GAIN_LABEL: Record<RareGain['stat'], string> = {
  code: '代码',
  thinking: '思维',
  setting: '出题',
  mindset: '心态',
  focus_cap: '专注上限',
  stamina_regen: '体力恢复',
};

export function TrainingPage(): JSX.Element {
  const studentsQ = useStudents();
  const inv = useInventory();
  const problems = useProblems();
  const basic = useBasicTrain();
  const directed = useDirectedTrain();
  const specialized = useSpecializedTrain();

  const [studentId, setStudentId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('basic');
  const [dim, setDim] = useState<DimensionKey>('DS');
  const [bookItemId, setBookItemId] = useState<string>('');
  const [problemId, setProblemId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<(TrainingResult & { studentName: string }) | null>(null);

  if (studentsQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-neutral-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
        加载学员中…
      </div>
    );
  }
  if (studentsQ.isError || !studentsQ.data) {
    return (
      <div className="space-y-2 text-sm text-red-600">
        <p>学员数据加载失败：{apiErrorMessage(studentsQ.error)}</p>
        <button
          className="rounded border px-3 py-1 text-xs"
          onClick={() => void studentsQ.refetch()}
        >
          重试
        </button>
      </div>
    );
  }
  const students = studentsQ.data;
  const chosen = students.find((s) => s.id === studentId) ?? null;

  const books = (inv.data ?? []).filter((i) => i.category === 'book' && isSixDimBook(i.itemId));
  const dimBooks = books.filter((b) => b.itemId.startsWith(`book-${DIM_BOOK_SUBJECT[dim]}-`));
  const selectableProblems = (problems.data ?? []).filter((p) => p.consumedAt === null);

  function runBasic(): void {
    if (!chosen) return;
    basic.mutate(chosen.id, {
      onSuccess: (r) => showResult(r, chosen),
      onError: (e) => setMsg(errText(e)),
    });
  }

  function runDirected(): void {
    if (!chosen) return;
    const bid = bookItemId === '' ? undefined : bookItemId;
    directed.mutate(
      { studentId: chosen.id, dim, bookItemId: bid },
      {
        onSuccess: (r) => showResult(r, chosen),
        onError: (e) => setMsg(errText(e)),
      },
    );
  }

  function runSpecialized(): void {
    if (!chosen || problemId == null) return;
    specialized.mutate(
      { studentId: chosen.id, problemId },
      {
        onSuccess: (r) => showResult(r, chosen),
        onError: (e) => setMsg(errText(e)),
      },
    );
  }

  function showResult(r: TrainingResult, s: StudentView): void {
    setResult({ ...r, studentName: s.name });
    setMsg(null);
  }

  const pending = basic.isPending || directed.isPending || specialized.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold">训练</h1>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">选择学员</h2>
        {students.length === 0 ? (
          <Empty
            icon="🎓"
            title="还没有学员"
            action={
              <Link
                to="/academy"
                className="inline-block rounded bg-neutral-900 px-4 py-2 text-sm text-white"
              >
                前往高级学院招募
              </Link>
            }
          >
            先招募一名学员，再开始针对性训练吧。
          </Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {students.map((s) => (
              <button
                key={s.id}
                onClick={() => setStudentId(s.id)}
                className={`rounded border px-3 py-1.5 text-sm ${
                  studentId === s.id
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'hover:bg-neutral-100'
                }`}
              >
                {s.name}
                <span className="ml-1 text-xs opacity-70">{QUALITY_LABEL[s.qualityTier]}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {chosen && (
        <section className="rounded border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">{chosen.name} 训练</h2>
          <div className="mb-3 flex gap-1 rounded bg-neutral-100 p-1 text-sm">
            {(['basic', 'directed', 'specialized'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded px-3 py-1.5 ${tab === t ? 'bg-white shadow' : ''}`}
              >
                {tabLabel(t)}
              </button>
            ))}
          </div>

          {tab === 'basic' && (
            <div className="space-y-3">
              <p className="text-sm text-neutral-500">
                基础训练：随机提升一维，消耗 1 体力与训练费。
              </p>
              <button
                className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                disabled={pending || Math.floor(chosen.stamina) < 1}
                onClick={runBasic}
              >
                开始基础训练（体力 {floor(chosen.stamina)}/5）
              </button>
            </div>
          )}

          {tab === 'directed' && (
            <div className="space-y-3">
              <p className="text-sm text-neutral-500">
                定向训练：自选一维，消耗对应六维书×1 + 1 体力 + 训练费。
              </p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(DIMENSION_LABEL) as DimensionKey[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setDim(d);
                      setBookItemId('');
                    }}
                    className={`rounded border px-3 py-1.5 text-sm ${
                      dim === d
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'hover:bg-neutral-100'
                    }`}
                  >
                    {DIMENSION_LABEL[d]}
                  </button>
                ))}
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">选择书籍（默认基础手册 {dim}）</p>
                <select
                  className="rounded border px-3 py-1.5 text-sm"
                  value={bookItemId}
                  onChange={(e) => setBookItemId(e.target.value)}
                >
                  <option value="">默认（{DIMENSION_LABEL[dim]}·基础手册）</option>
                  {dimBooks.map((b) => (
                    <option key={b.itemId} value={b.itemId}>
                      {b.name}（×{b.quantity}）
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                disabled={pending || Math.floor(chosen.stamina) < 1}
                onClick={runDirected}
              >
                开始定向训练
              </button>
            </div>
          )}

          {tab === 'specialized' && (
            <div className="space-y-3">
              <p className="text-sm text-neutral-500">
                专项训练：选题，消耗预制题×1 + 1 体力 + 训练费。
              </p>
              {problems.isError ? (
                <p className="text-sm text-neutral-400">
                  题库接口暂不可用（后端未提供 GET /api/problems）。
                </p>
              ) : problems.isLoading ? (
                <p className="text-sm text-neutral-400">加载题库…</p>
              ) : selectableProblems.length === 0 ? (
                <p className="text-sm text-neutral-400">
                  暂无可用预制题（需先用出题功能或获取样例题）。
                </p>
              ) : (
                <div className="space-y-2">
                  {selectableProblems.map((p) => (
                    <ProblemRow
                      key={p.id}
                      p={p}
                      selected={problemId === p.id}
                      onSelect={() => setProblemId(p.id)}
                    />
                  ))}
                </div>
              )}
              <button
                className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                disabled={pending || problemId == null || Math.floor(chosen.stamina) < 1}
                onClick={runSpecialized}
              >
                开始专项训练
              </button>
            </div>
          )}

          {msg && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {msg}
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="rounded border border-green-200 bg-green-50 p-4">
          <h3 className="mb-1 font-semibold text-green-800">训练完成</h3>
          <p className="text-sm text-green-800">
            {result.studentName}：{DIMENSION_LABEL[result.dim]} +{roundDelta(result.delta)} · 消耗{' '}
            {result.cost} 金 · 剩余体力 {Math.floor(result.staminaAfter)}/5
          </p>
          {result.rareGains.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-sm text-green-700">
              {result.rareGains.map((g) => (
                <li key={g.stat}>
                  稀有成长：{GAIN_LABEL[g.stat]} +{roundDelta(g.amount)}
                </li>
              ))}
            </ul>
          )}
          <button className="mt-2 text-xs text-green-700 underline" onClick={() => setResult(null)}>
            关闭
          </button>
        </section>
      )}
    </div>
  );
}

function ProblemRow({
  p,
  selected,
  onSelect,
}: {
  p: ProblemView;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-sm ${
        selected ? 'border-neutral-900 bg-neutral-50' : 'hover:bg-neutral-50'
      }`}
    >
      <input
        type="radio"
        name="problem"
        className="accent-neutral-900"
        checked={selected}
        onChange={onSelect}
      />
      <span className="font-medium">{p.name}</span>
      <span className={`rounded px-1.5 py-0.5 text-xs ${rarityBadge(p.rarity)}`}>
        {rarityText(p.rarity)}
      </span>
      <span className="text-xs text-neutral-500">{DIMENSION_LABEL[p.dominantDim]}</span>
      <span className="text-xs text-neutral-400">Q {p.quality}</span>
    </label>
  );
}

function tabLabel(t: Tab): string {
  switch (t) {
    case 'basic':
      return '基础';
    case 'directed':
      return '定向';
    default:
      return '专项';
  }
}

function isSixDimBook(itemId: string): boolean {
  const m = /^book-(.+)-\w+$/.exec(itemId);
  return m ? ['ds', 'dp', 'math', 'graph', 'greedy', 'string'].includes(m[1]) : false;
}

function roundDelta(v: number): number {
  return round(v * 100) / 100;
}

function errText(e: unknown): string {
  return apiErrorMessage(e);
}
