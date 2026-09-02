import { useState, type JSX } from 'react';
import { ApiCallError } from '../../lib/api';
import {
  useLectureLogs,
  useLectureTiers,
  useStudents,
  useTeachLecture,
  type LectureTierId,
} from '../../lib/hooks';

const TIER_LABEL: Record<LectureTierId, string> = {
  beginner: '入门组',
  junior: '普及组',
  senior: '提高组',
  provincial: '省选组',
  national: '国家队集训队',
};

export function AcademyLecturePage(): JSX.Element {
  const students = useStudents();
  const tiers = useLectureTiers();
  const logs = useLectureLogs();
  const teach = useTeachLecture();
  const [studentId, setStudentId] = useState<number>();
  const [tier, setTier] = useState<LectureTierId>('beginner');
  const [force, setForce] = useState(false);

  if (students.isPending || tiers.isPending || logs.isPending) return <p className="text-neutral-500">加载讲课数据…</p>;
  if (students.isError || tiers.isError || logs.isError || !students.data || !tiers.data || !logs.data) {
    return <p className="text-red-600">讲课数据加载失败，请稍后重试。</p>;
  }

  const selectedStudentId = studentId ?? students.data[0]?.id;
  const selectedStudent = students.data.find((student) => student.id === selectedStudentId);
  const selectedTier = tiers.data.find((entry) => entry.id === tier) ?? tiers.data[0];
  const canForce =
    selectedStudent !== undefined &&
    selectedTier !== undefined &&
    selectedStudent.v < selectedTier.threshold &&
    selectedStudent.v >= selectedTier.threshold - 8;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-b border-neutral-300 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Academy Lecture</p>
        <h1 className="mt-1 text-2xl font-semibold">讲课</h1>
        <p className="mt-2 text-sm text-neutral-500">用学员的综合能力承接不同层级的训练营课程。</p>
      </div>

      <section className="grid gap-4 border-b border-neutral-200 pb-5 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-2 block text-neutral-500">主讲学员</span>
          <select
            className="w-full rounded border border-neutral-300 bg-white px-3 py-2"
            value={selectedStudentId ?? ''}
            onChange={(event) => setStudentId(Number(event.target.value))}
          >
            {students.data.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name} · V {student.v} · 体力 {Math.floor(student.stamina)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-2 block text-neutral-500">受众档位</span>
          <select
            className="w-full rounded border border-neutral-300 bg-white px-3 py-2"
            value={tier}
            onChange={(event) => {
              setTier(event.target.value as LectureTierId);
              setForce(false);
            }}
          >
            {tiers.data.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {TIER_LABEL[entry.id]} · 门槛 V{entry.threshold}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="border border-neutral-300 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-medium">{selectedStudent?.name ?? '暂无学员'}</span>
            <span className="ml-3 text-neutral-500">
              当前 V {selectedStudent?.v ?? '-'} · 目标门槛 V {selectedTier?.threshold ?? '-'} · 体力消耗 2
            </span>
          </div>
          <button
            type="button"
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
            disabled={selectedStudentId === undefined || selectedTier === undefined || teach.isPending}
            onClick={() =>
              selectedStudentId !== undefined &&
              teach.mutate({ studentId: selectedStudentId, tier, force: force && canForce })
            }
          >
            {teach.isPending ? '结算中…' : '开始讲课'}
          </button>
        </div>
        {canForce && (
          <label className="mt-4 flex items-center gap-2 border-t border-neutral-200 pt-3 text-sm text-amber-800">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            强接此档位，接受讲砸或折扣结算风险
          </label>
        )}
        {teach.isError && (
          <p className="mt-3 text-sm text-red-600">
            {teach.error instanceof ApiCallError && teach.error.code === 'INSUFFICIENT_RESOURCE'
              ? '体力不足'
              : '讲课未能开始，请检查门槛、额度和体力。'}
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between border-b border-neutral-300 pb-2">
          <h2 className="text-lg font-semibold">讲课记录</h2>
          <span className="text-xs text-neutral-500">最近 {logs.data.length} 条</span>
        </div>
        {logs.data.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无记录。</p>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200 bg-white">
            {logs.data.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm">
                <div>
                  <span className="font-medium">{TIER_LABEL[entry.tier]}</span>
                  <span className="ml-2 text-xs text-neutral-500">V {entry.teachingValue}</span>
                </div>
                <div className="text-right text-xs">
                  <span className={entry.success ? 'text-green-700' : 'text-red-700'}>
                    {entry.success ? '成功' : '讲砸'} · 钱 {entry.money >= 0 ? '+' : ''}{entry.money} · 声誉 {entry.reputation >= 0 ? '+' : ''}{entry.reputation}
                  </span>
                  <time className="ml-3 text-neutral-500">{new Date(entry.createdAt).toLocaleString()}</time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
