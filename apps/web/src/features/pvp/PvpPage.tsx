import { useState, type JSX } from 'react';
import { Swords } from 'lucide-react';
import { Chip, Empty, ErrorNote, InlineLoader, PageHeader } from '../../components/ui';
import { Metric } from '../records/shared/bits';
import { useItemName } from '../records/shared/rewards';
import { tournamentStatusLabel } from '../../lib/labels';
import { BracketView } from './BracketView';
import { RewardBoard } from './RewardBoard';
import { RegistrationForm, RegistrationView } from './RegistrationPanel';
import {
  useClaimPvpReward,
  useInventory,
  useMe,
  useNow,
  useProblemLibrary,
  usePvpBracket,
  usePvpRegistration,
  usePvpRewards,
  usePvpTournamentDetail,
  usePvpTournaments,
  useRegisterPvp,
  useStudents,
  type ProblemView,
  type PvpMatchView,
  type PvpRegistrationView,
  type PvpRewardGrantView,
  type PvpTournamentDetailView,
} from '../../lib/hooks';
import type { StudentView } from '@oinur/shared';

/** 倒计时（每秒自刷新，只有本组件重渲染） */
function Countdown({ at, done }: { at: string; done: string }): JSX.Element {
  const now = useNow(1000);
  const remain = new Date(at).getTime() - now;
  if (!Number.isFinite(remain)) return <span className="text-fg-dim">—</span>;
  if (remain <= 0) return <span className="text-fg-dim">{done}</span>;
  const hours = Math.floor(remain / 3_600_000);
  const minutes = Math.floor(remain / 60_000) % 60;
  const seconds = Math.floor(remain / 1000) % 60;
  return (
    <span>
      {hours > 0 ? `${hours} 时 ` : ''}
      {minutes} 分 {seconds} 秒
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  REGISTERING: 'border-cyber-500/60 text-cyber-300',
  RUNNING: 'border-arc-400/60 text-arc-300',
  FINISHED: 'border-ink-600 text-fg-dim',
  CANCELLED: 'border-bad-400/50 text-bad-400',
};

export function PvpPage(): JSX.Element {
  const me = useMe();
  const tournaments = usePvpTournaments();
  const students = useStudents();
  const problems = useProblemLibrary();
  const inventory = useInventory();
  const [tournamentId, setTournamentId] = useState<number>();
  const [roster, setRoster] = useState<number[]>([]);
  const [problemIds, setProblemIds] = useState<number[]>([]);

  const selectedTournamentId = tournamentId ?? tournaments.data?.[0]?.id;
  const entry = tournaments.data?.find((row) => row.id === selectedTournamentId);
  // 终态赛事不再重取：服务端每次推进都要拿行锁，且数据不会再变
  const terminal = entry?.status === 'FINISHED' || entry?.status === 'CANCELLED';
  const registration = usePvpRegistration(selectedTournamentId);
  const detail = usePvpTournamentDetail(selectedTournamentId, terminal);
  const bracket = usePvpBracket(selectedTournamentId, terminal);
  const rewards = usePvpRewards(selectedTournamentId, terminal);
  const register = useRegisterPvp();
  const claimReward = useClaimPvpReward();
  const itemName = useItemName();

  const needsTournament = selectedTournamentId !== undefined;
  const basePending =
    tournaments.isPending || students.isPending || problems.isPending || inventory.isPending;
  const tournamentPending =
    needsTournament && (detail.isPending || bracket.isPending || rewards.isPending);
  if (basePending || tournamentPending) {
    return (
      <div className="space-y-5" data-testid="pvp-page">
        <PageHeader eyebrow="锦标赛" title="PVP 锦标赛" />
        <InlineLoader>正在接入赛事频道…</InlineLoader>
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
    return (
      <div className="space-y-5" data-testid="pvp-page">
        <PageHeader eyebrow="锦标赛" title="PVP 锦标赛" />
        <ErrorNote
          onRetry={() => {
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
          赛事频道暂时不可用，请稍后重试。
        </ErrorNote>
      </div>
    );
  }

  const tickets = inventory.data.find((item) => item.itemId === 'entry-ticket')?.quantity ?? 0;
  const eligibleProblems = problems.data.filter((problem) => problem.quality >= 40);

  return (
    <div className="space-y-5" data-testid="pvp-page">
      <PageHeader
        eyebrow="锦标赛"
        title="PVP 锦标赛"
        description="组队报名 → 到点自动开赛 → 单败淘汰；对阵双方可回看当场战报。"
        actions={
          entry === undefined ? undefined : (
            <span
              className={`inline-flex items-center border border-l-2 px-2 py-0.5 text-xs ${
                STATUS_TONE[entry.status] ?? 'border-ink-600 text-fg-dim'
              }`}
            >
              {tournamentStatusLabel(entry.status)}
            </span>
          )
        }
      />

      {tournaments.data.length === 0 ? (
        <Empty icon={Swords} title="暂无开放赛事">
          管理员发布锦标赛后会出现在这里。报名需持有报名券，可留意公告。
        </Empty>
      ) : (
        <>
          <div className="panel max-w-2xl px-4 py-3">
            <label className="block">
              <span className="mb-1.5 block text-xs text-fg-dim">选择赛事</span>
              <select
                data-testid="pvp-select"
                className="w-full border px-3 py-2 text-sm"
                value={selectedTournamentId ?? ''}
                onChange={(event) => {
                  setTournamentId(Number(event.target.value));
                  setRoster([]);
                  setProblemIds([]);
                }}
              >
                {tournaments.data.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · {row.size} 强 · 每队 {row.rosterSize} 人 ·{' '}
                    {tournamentStatusLabel(row.status)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {detail.data !== undefined && (
            <TournamentPanel
              tournament={detail.data}
              students={students.data}
              problems={eligibleProblems}
              tickets={tickets}
              roster={roster}
              onRosterChange={setRoster}
              problemIds={problemIds}
              onProblemsChange={setProblemIds}
              registration={registration.data}
              bracket={bracket.data ?? []}
              rewards={rewards.data ?? []}
              meId={me.data?.id}
              meName={me.data?.username}
              itemName={itemName}
              onSubmit={() =>
                register.mutate({
                  tournamentId: detail.data.id,
                  studentIds: roster,
                  problemEntryIds: problemIds,
                })
              }
              registerPending={register.isPending}
              registerError={register.error}
              onClaim={() => claimReward.mutate(detail.data.id)}
              claimPending={claimReward.isPending}
              claimedGrantId={claimReward.data?.id}
            />
          )}
        </>
      )}
    </div>
  );
}

function TournamentPanel({
  tournament,
  students,
  problems,
  tickets,
  roster,
  onRosterChange,
  problemIds,
  onProblemsChange,
  registration,
  bracket,
  rewards,
  meId,
  meName,
  itemName,
  onSubmit,
  registerPending,
  registerError,
  onClaim,
  claimPending,
  claimedGrantId,
}: {
  tournament: PvpTournamentDetailView;
  students: StudentView[];
  problems: ProblemView[];
  tickets: number;
  roster: number[];
  onRosterChange: (ids: number[]) => void;
  problemIds: number[];
  onProblemsChange: (ids: number[]) => void;
  registration: PvpRegistrationView | undefined;
  bracket: PvpMatchView[];
  rewards: PvpRewardGrantView[];
  meId: number | undefined;
  meName: string | undefined;
  itemName: (itemId: string) => string;
  onSubmit: () => void;
  registerPending: boolean;
  registerError: unknown;
  onClaim: () => void;
  claimPending: boolean;
  claimedGrantId: number | undefined;
}): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-hd">
        <div className="min-w-0">
          <p className="eyebrow">赛事信息</p>
          <h2 className="truncate text-sm font-semibold">{tournament.name}</h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Chip>{tournament.size} 强</Chip>
          <Chip>每队 {tournament.rosterSize} 人</Chip>
        </div>
      </header>

      <div className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="已报名队伍" value={`${tournament.registeredCount} / ${tournament.size}`} />
          <Metric
            label="报名截止"
            value={<Countdown at={tournament.registerEndsAt} done="已截止（到点自动开赛）" />}
            tone="text-fg-muted"
          />
          <Metric
            label="自动开赛"
            value={<Countdown at={tournament.autoStartAt} done="已进入开赛流程" />}
            tone="text-fg-muted"
          />
          <Metric label="报名券" value={tickets} tone="text-cyber-300" />
        </div>

        {registration !== undefined ? (
          <RegistrationView registration={registration} />
        ) : tournament.status !== 'REGISTERING' ? (
          <p className="border border-ink-600/70 bg-ink-850/40 px-4 py-3 text-sm text-fg-dim">
            报名窗口已关闭，等待赛程推进。
          </p>
        ) : (
          <RegistrationForm
            students={students}
            problems={problems}
            rosterSize={tournament.rosterSize}
            tickets={tickets}
            roster={roster}
            onRosterChange={onRosterChange}
            problemIds={problemIds}
            onProblemsChange={onProblemsChange}
            onSubmit={onSubmit}
            pending={registerPending}
            error={registerError}
          />
        )}

        {bracket.length > 0 && <BracketView matches={bracket} meId={meId} meName={meName} />}

        {rewards.length > 0 && (
          <RewardBoard
            grants={rewards}
            meId={meId}
            meName={meName}
            claimedGrantId={claimedGrantId}
            itemName={itemName}
            onClaim={onClaim}
            pending={claimPending}
          />
        )}
      </div>
    </section>
  );
}
