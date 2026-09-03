import { useState, type JSX } from 'react';
import { ApiCallError } from '../../lib/api';
import {
  useInventory,
  usePvpRegistration,
  usePvpTournaments,
  useProblems,
  useRegisterPvp,
  useStudents,
  type PvpRegistrationView,
} from '../../lib/hooks';

export function PvpPage(): JSX.Element {
  const tournaments = usePvpTournaments();
  const students = useStudents();
  const problems = useProblems();
  const inventory = useInventory();
  const [tournamentId, setTournamentId] = useState<number>();
  const [studentId, setStudentId] = useState<number>();
  const selectedTournamentId = tournamentId ?? tournaments.data?.[0]?.id;
  const registration = usePvpRegistration(selectedTournamentId);
  const register = useRegisterPvp();
  const [problemIds, setProblemIds] = useState<number[]>([]);

  if (tournaments.isPending || students.isPending || problems.isPending || inventory.isPending) {
    return <p className="text-neutral-500">加载 PVP 数据…</p>;
  }
  if (
    tournaments.isError ||
    students.isError ||
    problems.isError ||
    inventory.isError ||
    !tournaments.data ||
    !students.data ||
    !problems.data ||
    !inventory.data
  ) {
    return <p className="text-red-600">PVP 数据加载失败。</p>;
  }

  const selectedTournament = tournaments.data.find((entry) => entry.id === selectedTournamentId);
  const selectedStudentId = studentId ?? students.data[0]?.id;
  const selectedRegistration = registration.data;
  const tickets = inventory.data.find((item) => item.itemId === 'entry-ticket')?.quantity ?? 0;
  const eligibleProblems = problems.data.filter((problem) => problem.quality >= 40);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-neutral-300 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">PVP Circuit</p>
        <h1 className="mt-1 text-2xl font-semibold">PVP 锦标赛</h1>
      </div>

      {tournaments.data.length === 0 ? (
        <p className="text-sm text-neutral-500">暂无开放赛事。</p>
      ) : (
        <>
          <label className="block max-w-xl text-sm">
            <span className="mb-2 block text-neutral-500">选择赛事</span>
            <select className="w-full rounded border border-neutral-300 bg-white px-3 py-2" value={selectedTournamentId ?? ''} onChange={(event) => { setTournamentId(Number(event.target.value)); setProblemIds([]); }}>
              {tournaments.data.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.size} 人 · {entry.status}</option>)}
            </select>
          </label>
          {selectedTournament && (
            <section className="border border-neutral-300 bg-white p-4">
              <div className="flex flex-wrap justify-between gap-3 text-sm">
                <div><p className="font-medium">{selectedTournament.name}</p><p className="mt-1 text-xs text-neutral-500">报名截止 {new Date(selectedTournament.registerEndsAt).toLocaleString()} · 自动开始 {new Date(selectedTournament.autoStartAt).toLocaleString()}</p></div>
                <span className="text-neutral-500">报名券 {tickets}</span>
              </div>
              {selectedRegistration ? <RegistrationView registration={selectedRegistration} /> : selectedTournament.status !== 'REGISTERING' ? <p className="mt-4 text-sm text-amber-700">报名已关闭。</p> : <RegistrationForm students={students.data} problems={eligibleProblems} studentId={selectedStudentId} onStudentChange={setStudentId} problemIds={problemIds} onProblemsChange={setProblemIds} onSubmit={() => selectedStudentId !== undefined && register.mutate({ tournamentId: selectedTournament.id, studentId: selectedStudentId, problemEntryIds: problemIds })} pending={register.isPending} error={register.error} />}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function RegistrationForm({ students, problems, studentId, onStudentChange, problemIds, onProblemsChange, onSubmit, pending, error }: { students: { id: number; name: string; v: number }[]; problems: { id: number; name: string; quality: number }[]; studentId: number | undefined; onStudentChange: (id: number) => void; problemIds: number[]; onProblemsChange: (ids: number[]) => void; onSubmit: () => void; pending: boolean; error: unknown }): JSX.Element {
  return (
    <div className="mt-5 space-y-4 border-t border-neutral-200 pt-4">
      <label className="block text-sm"><span className="mb-2 block text-neutral-500">出战学员</span><select className="w-full rounded border border-neutral-300 bg-white px-3 py-2" value={studentId ?? ''} onChange={(event) => onStudentChange(Number(event.target.value))}>{students.map((student) => <option key={student.id} value={student.id}>{student.name} · V {student.v}</option>)}</select></label>
      <fieldset><legend className="mb-2 text-sm text-neutral-500">携带预制题（最多 2 道，Q ≥ 40）</legend><div className="grid gap-2 sm:grid-cols-2">{problems.map((problem) => <label key={problem.id} className="flex items-center gap-2 rounded border border-neutral-200 px-3 py-2 text-sm"><input type="checkbox" checked={problemIds.includes(problem.id)} disabled={!problemIds.includes(problem.id) && problemIds.length >= 2} onChange={(event) => onProblemsChange(event.target.checked ? [...problemIds, problem.id] : problemIds.filter((id) => id !== problem.id))} /><span>{problem.name} · Q {problem.quality}</span></label>)}</div></fieldset>
      <button type="button" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={studentId === undefined || pending} onClick={onSubmit}>{pending ? '报名中…' : '提交报名'}</button>
      {error !== undefined && error !== null && <p className="text-sm text-red-600">{error instanceof ApiCallError && error.code === 'INSUFFICIENT_RESOURCE' ? '报名券不足。' : '报名失败，请检查资格与截止时间。'}</p>}
    </div>
  );
}

function RegistrationView({ registration }: { registration: PvpRegistrationView }): JSX.Element {
  return <div className="mt-5 border-t border-neutral-200 pt-4 text-sm"><p className="font-medium text-green-700">已报名，快照已锁定</p><p className="mt-2 text-neutral-600">出战：{registration.roster.map((student) => student.displayName).join('、')}</p><p className="mt-1 text-neutral-600">携带题：{registration.problemSnapshots.length > 0 ? registration.problemSnapshots.map((problem) => `${problem.name}（Q${problem.quality}）`).join('、') : '未携带'}</p></div>;
}
