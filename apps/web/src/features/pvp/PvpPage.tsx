import { useState, type JSX } from 'react';
import { ApiCallError } from '../../lib/api';
import { Empty } from '../../components/ui';
import {
  useInventory,
  usePvpRegistration,
  usePvpTournamentDetail,
  usePvpBracket,
  usePvpRewards,
  useClaimPvpReward,
  usePvpTournaments,
  useProblems,
  useRegisterPvp,
  useStudents,
  type PvpRegistrationView,
  type PvpRewardGrantView,
  type PvpRewardLine,
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
  const detail = usePvpTournamentDetail(selectedTournamentId);
  const bracket = usePvpBracket(selectedTournamentId);
  const rewards = usePvpRewards(selectedTournamentId);
  const register = useRegisterPvp();
  const claimReward = useClaimPvpReward();
  const [problemIds, setProblemIds] = useState<number[]>([]);

  // detail/bracket/rewards 仅在选中具体赛事后才需要（无赛事时禁用查询不应卡在加载）
  const needsTournament = selectedTournamentId !== undefined;
  const basePending =
    tournaments.isPending || students.isPending || problems.isPending || inventory.isPending;
  const tournamentPending =
    needsTournament && (detail.isPending || bracket.isPending || rewards.isPending);
  if (basePending || tournamentPending) {
    return (
      <div className="flex items-center gap-2 text-neutral-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
        加载 PVP 数据…
      </div>
    );
  }
  const baseError =
    tournaments.isError ||
    students.isError ||
    problems.isError ||
    inventory.isError ||
    !tournaments.data ||
    !students.data ||
    !problems.data ||
    !inventory.data;
  const tournamentError =
    needsTournament &&
    (detail.isError ||
      bracket.isError ||
      rewards.isError ||
      !detail.data ||
      !bracket.data ||
      !rewards.data);
  if (baseError || tournamentError) {
    const firstError =
      tournaments.error ??
      students.error ??
      problems.error ??
      inventory.error ??
      detail.error ??
      bracket.error ??
      rewards.error;
    return (
      <div className="space-y-2 text-sm text-red-600">
        <p>PVP 数据加载失败：{firstError instanceof ApiCallError ? firstError.code : '网络异常'}</p>
        <button
          className="rounded border px-3 py-1 text-xs"
          onClick={() => {
            void tournaments.refetch();
            void students.refetch();
            void problems.refetch();
            void inventory.refetch();
            if (needsTournament) {
              void detail.refetch();
              void bracket.refetch();
              void rewards.refetch();
            }
          }}
        >
          重试
        </button>
      </div>
    );
  }

  const selectedTournamentEntry = tournaments.data.find(
    (entry) => entry.id === selectedTournamentId,
  );
  const selectedTournament =
    selectedTournamentEntry === undefined || detail.data === undefined
      ? selectedTournamentEntry
      : { ...selectedTournamentEntry, ...detail.data };
  const selectedStudentId = studentId ?? students.data[0]?.id;
  const selectedRegistration = registration.data;
  const tickets = inventory.data.find((item) => item.itemId === 'entry-ticket')?.quantity ?? 0;
  const eligibleProblems = problems.data.filter((problem) => problem.quality >= 40);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-neutral-300 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
          PVP Circuit
        </p>
        <h1 className="mt-1 text-2xl font-semibold">PVP 锦标赛</h1>
      </div>

      {tournaments.data.length === 0 ? (
        <Empty icon="🏆" title="暂无开放赛事">
          管理员发布锦标赛后会出现在这里。报名需持有报名券（entry-ticket），可留意公告。
        </Empty>
      ) : (
        <>
          <label className="block max-w-xl text-sm">
            <span className="mb-2 block text-neutral-500">选择赛事</span>
            <select
              className="w-full rounded border border-neutral-300 bg-white px-3 py-2"
              value={selectedTournamentId ?? ''}
              onChange={(event) => {
                setTournamentId(Number(event.target.value));
                setProblemIds([]);
              }}
            >
              {tournaments.data.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · {entry.size} 人 · {entry.status}
                </option>
              ))}
            </select>
          </label>
          {selectedTournament && (
            <section className="border border-neutral-300 bg-white p-4">
              <div className="flex flex-wrap justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium">{selectedTournament.name}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    报名截止 {new Date(selectedTournament.registerEndsAt).toLocaleString()} ·
                    自动开始 {new Date(selectedTournament.autoStartAt).toLocaleString()}
                  </p>
                </div>
                <span className="text-neutral-500">报名券 {tickets}</span>
              </div>
              {selectedRegistration ? (
                <RegistrationView registration={selectedRegistration} />
              ) : selectedTournament.status !== 'REGISTERING' ? (
                <p className="mt-4 text-sm text-amber-700">报名已关闭。</p>
              ) : (
                <RegistrationForm
                  students={students.data}
                  problems={eligibleProblems}
                  studentId={selectedStudentId}
                  onStudentChange={setStudentId}
                  problemIds={problemIds}
                  onProblemsChange={setProblemIds}
                  onSubmit={() =>
                    selectedStudentId !== undefined &&
                    register.mutate({
                      tournamentId: selectedTournament.id,
                      studentId: selectedStudentId,
                      problemEntryIds: problemIds,
                    })
                  }
                  pending={register.isPending}
                  error={register.error}
                />
              )}
              {(bracket.data?.length ?? 0) > 0 && <BracketView matches={bracket.data ?? []} />}
              {(rewards.data?.length ?? 0) > 0 && (
                <RewardGrants
                  grants={rewards.data ?? []}
                  onClaim={() =>
                    selectedTournamentId !== undefined && claimReward.mutate(selectedTournamentId)
                  }
                  pending={claimReward.isPending}
                />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function rewardLabel(reward: PvpRewardLine): string {
  if (reward.type === 'item') return `${reward.itemId} ×${reward.count}`;
  if (reward.type === 'money') return `资金 +${reward.amount}`;
  return `声誉 +${reward.amount}`;
}

function RewardGrants({
  grants,
  onClaim,
  pending,
}: {
  grants: PvpRewardGrantView[];
  onClaim: () => void;
  pending: boolean;
}): JSX.Element {
  return (
    <div className="mt-6 border-t border-neutral-200 pt-4">
      <h2 className="text-sm font-medium">赛事奖励公示</h2>
      <div className="mt-3 divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
        {grants.map((grant) => (
          <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium">
                第 {grant.rank} 名 · 用户 {grant.userId}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {grant.rewards.length === 0 ? '无奖励' : grant.rewards.map(rewardLabel).join(' · ')}
              </p>
            </div>
            {grant.claimedAt !== null ? (
              <span className="text-xs text-green-700">已领取</span>
            ) : grant.claimable ? (
              <button
                type="button"
                className="rounded bg-neutral-900 px-3 py-2 text-xs text-white disabled:opacity-50"
                disabled={pending}
                onClick={onClaim}
              >
                {pending ? '领取中…' : '领取奖励'}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketView({
  matches,
}: {
  matches: import('../../lib/hooks').PvpMatchView[];
}): JSX.Element {
  const rounds = [...new Set(matches.map((match) => match.round))];
  return (
    <div className="mt-6 border-t border-neutral-200 pt-4">
      <h2 className="text-sm font-medium">对阵结果</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        {rounds.map((round) => (
          <div key={round}>
            <h3 className="text-xs font-semibold uppercase text-neutral-500">第 {round} 轮</h3>
            <div className="mt-2 space-y-2">
              {matches
                .filter((match) => match.round === round)
                .map((match) => (
                  <div key={match.id} className="border border-neutral-200 p-2 text-xs">
                    <p>
                      {match.homeUserId ?? '轮空'} {match.homeScore ?? '-'} :{' '}
                      {match.awayScore ?? '-'} {match.awayUserId ?? '轮空'}
                    </p>
                    <p className="mt-1 text-neutral-500">胜者：{match.winnerUserId ?? '-'}</p>
                    {match.reportUrl && (
                      <a
                        className="mt-1 inline-block text-blue-700 underline"
                        href={match.reportUrl}
                      >
                        查看战报
                      </a>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegistrationForm({
  students,
  problems,
  studentId,
  onStudentChange,
  problemIds,
  onProblemsChange,
  onSubmit,
  pending,
  error,
}: {
  students: { id: number; name: string; v: number }[];
  problems: { id: number; name: string; quality: number }[];
  studentId: number | undefined;
  onStudentChange: (id: number) => void;
  problemIds: number[];
  onProblemsChange: (ids: number[]) => void;
  onSubmit: () => void;
  pending: boolean;
  error: unknown;
}): JSX.Element {
  return (
    <div className="mt-5 space-y-4 border-t border-neutral-200 pt-4">
      <label className="block text-sm">
        <span className="mb-2 block text-neutral-500">出战学员</span>
        <select
          className="w-full rounded border border-neutral-300 bg-white px-3 py-2"
          value={studentId ?? ''}
          onChange={(event) => onStudentChange(Number(event.target.value))}
        >
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.name} · V {student.v}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="mb-2 text-sm text-neutral-500">携带预制题（最多 2 道，Q ≥ 40）</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {problems.map((problem) => (
            <label
              key={problem.id}
              className="flex items-center gap-2 rounded border border-neutral-200 px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={problemIds.includes(problem.id)}
                disabled={!problemIds.includes(problem.id) && problemIds.length >= 2}
                onChange={(event) =>
                  onProblemsChange(
                    event.target.checked
                      ? [...problemIds, problem.id]
                      : problemIds.filter((id) => id !== problem.id),
                  )
                }
              />
              <span>
                {problem.name} · Q {problem.quality}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        disabled={studentId === undefined || pending}
        onClick={onSubmit}
      >
        {pending ? '报名中…' : '提交报名'}
      </button>
      {error !== undefined && error !== null && (
        <p className="text-sm text-red-600">
          {error instanceof ApiCallError && error.code === 'INSUFFICIENT_RESOURCE'
            ? '报名券不足。'
            : '报名失败，请检查资格与截止时间。'}
        </p>
      )}
    </div>
  );
}

function RegistrationView({ registration }: { registration: PvpRegistrationView }): JSX.Element {
  return (
    <div className="mt-5 border-t border-neutral-200 pt-4 text-sm">
      <p className="font-medium text-green-700">已报名，快照已锁定</p>
      <p className="mt-2 text-neutral-600">
        出战：{registration.roster.map((student) => student.displayName).join('、')}
      </p>
      <p className="mt-1 text-neutral-600">
        携带题：
        {registration.problemSnapshots.length > 0
          ? registration.problemSnapshots
              .map((problem) => `${problem.name}（Q${problem.quality}）`)
              .join('、')
          : '未携带'}
      </p>
    </div>
  );
}
