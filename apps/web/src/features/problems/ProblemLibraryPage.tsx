import { useState, type JSX } from 'react';
import { Link } from 'react-router';
import { ApiCallError, apiErrorMessage } from '../../lib/api';
import {
  DIMENSION_LABEL,
  rarityBadge,
  rarityLabel,
  useCreateProblem,
  useDeleteProblem,
  useProblemLibrary,
  useStudents,
  type ProblemView,
} from '../../lib/hooks';
import type { DimensionKey } from '@oinur/shared';
import { Empty } from '../../components/ui';

const DIMENSIONS: DimensionKey[] = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'];

function rarityClass(rarity: ProblemView['rarity']): string {
  return rarityBadge(rarity);
}

export function ProblemLibraryPage(): JSX.Element {
  const students = useStudents();
  const library = useProblemLibrary();
  const create = useCreateProblem();
  const remove = useDeleteProblem();
  const [studentId, setStudentId] = useState<number>();
  const [dimension, setDimension] = useState<DimensionKey>('DS');

  if (students.isPending || library.isPending) {
    return (
      <div className="flex items-center gap-2 text-neutral-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
        加载题库数据…
      </div>
    );
  }
  if (students.isError || library.isError || !students.data || !library.data) {
    return (
      <div className="space-y-2 text-sm text-red-600">
        <p>题库数据加载失败：{apiErrorMessage(students.error ?? library.error)}</p>
        <button
          className="rounded border px-3 py-1 text-xs"
          onClick={() => {
            void students.refetch();
            void library.refetch();
          }}
        >
          重试
        </button>
      </div>
    );
  }

  const selectedStudentId = studentId ?? students.data[0]?.id;
  const selectedStudent = students.data.find((student) => student.id === selectedStudentId);
  const error = create.error ?? remove.error;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-neutral-300 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
          Problem Library
        </p>
        <h1 className="mt-1 text-2xl font-semibold">出题题库</h1>
        <p className="mt-2 text-sm text-neutral-500">
          把学员的出题能力转成可以训练、对决和入赛的预制题。
        </p>
      </div>

      {students.data.length === 0 && (
        <Empty
          icon="📝"
          title="还没有可以出题的学员"
          action={
            <Link
              to="/academy"
              className="inline-block rounded bg-neutral-900 px-4 py-2 text-sm text-white"
            >
              前往高级学院招募
            </Link>
          }
        >
          出题需要学员的出题能力（setting），先去招募并培养一名学员吧。
        </Empty>
      )}

      <section className="grid gap-4 border-b border-neutral-200 pb-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="text-sm">
          <span className="mb-2 block text-neutral-500">出题学员</span>
          <select
            className="w-full rounded border border-neutral-300 bg-white px-3 py-2"
            value={selectedStudentId ?? ''}
            onChange={(event) => setStudentId(Number(event.target.value))}
          >
            {students.data.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name} · 出题 {Math.floor(student.setting)} · 体力{' '}
                {Math.floor(student.stamina)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-2 block text-neutral-500">主考维度</span>
          <select
            className="w-full rounded border border-neutral-300 bg-white px-3 py-2"
            value={dimension}
            onChange={(event) => setDimension(event.target.value as DimensionKey)}
          >
            {DIMENSIONS.map((entry) => (
              <option key={entry} value={entry}>
                {DIMENSION_LABEL[entry]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
          disabled={selectedStudentId === undefined || create.isPending}
          onClick={() =>
            selectedStudentId !== undefined &&
            create.mutate({ studentId: selectedStudentId, dimension })
          }
        >
          {create.isPending ? '评测中…' : '开始出题'}
        </button>
      </section>

      {selectedStudent && (
        <p className="text-sm text-neutral-500">
          当前学员：{selectedStudent.name} · 体力 {Math.floor(selectedStudent.stamina)} ·
          本日出题次数以服务端记录为准
        </p>
      )}
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error instanceof ApiCallError && error.code === 'STATE_CONFLICT'
            ? '题库已满（120 道上限）或本日出题次数已达上限。'
            : error instanceof ApiCallError && error.code === 'INSUFFICIENT_RESOURCE'
              ? '体力或金币不足，无法开始出题。'
              : `出题操作失败：${apiErrorMessage(error)}`}
        </p>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between border-b border-neutral-300 pb-2">
          <h2 className="text-lg font-semibold">我的预制题</h2>
          <span className="text-xs text-neutral-500">{library.data.length}/120</span>
        </div>
        {library.data.length === 0 ? (
          <Empty icon="🗒️" title="题库还是空的">
            用学员的出题能力创作第一道预制题。质量 ≥ 70 的题适合对决携带，绿色以上适合专项训练。
          </Empty>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200 bg-white">
            {library.data.map((problem) => (
              <ProblemRow
                key={problem.id}
                problem={problem}
                onDelete={() => remove.mutate(problem.id)}
                deleting={remove.isPending}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ProblemRow({
  problem,
  onDelete,
  deleting,
}: {
  problem: ProblemView;
  onDelete: () => void;
  deleting: boolean;
}): JSX.Element {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{problem.name}</span>
          <span className={`rounded px-2 py-0.5 text-xs ${rarityClass(problem.rarity)}`}>
            {rarityLabel(problem.rarity)}
          </span>
          <span className="text-xs text-neutral-500">Q {problem.quality}</span>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          主考：{DIMENSION_LABEL[problem.dominantDim]} · 特性：{problem.traitId ?? '无'}
        </p>
      </div>
      <button
        type="button"
        className="rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 disabled:opacity-50"
        disabled={deleting || problem.consumedAt !== null}
        onClick={onDelete}
      >
        删除
      </button>
    </li>
  );
}
