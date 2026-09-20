import type { JSX } from 'react';
import { Link } from 'react-router';
import { matchStatusLabel } from '../../lib/labels';
import type { PvpMatchView } from '../../lib/hooks';

/** 战报 URL 是 /api/records/{id} 形式，前端路由为 /records/{id} */
function recordPath(apiUrl: string): string {
  const prefix = '/api/records/';
  return apiUrl.startsWith(prefix) ? `/records/${apiUrl.slice(prefix.length)}` : apiUrl;
}

/**
 * 队名一律走中文：自己用账号名，其他选手用「选手 #id」兜底，
 * 绝不把 homeUserId 裸数字当队名。
 */
function teamLabel(userId: number | null, meId: number | undefined, meName: string | undefined): string {
  if (userId === null) return '轮空';
  if (meId !== undefined && userId === meId) return meName ?? '我的队伍';
  return `选手 #${userId}`;
}

function MatchCard({
  match,
  meId,
  meName,
}: {
  match: PvpMatchView;
  meId: number | undefined;
  meName: string | undefined;
}): JSX.Element {
  const mine = match.homeUserId === meId || match.awayUserId === meId;
  const decided = match.winnerUserId !== null;
  const homeWon = decided && match.winnerUserId === match.homeUserId;
  const awayWon = decided && match.winnerUserId === match.awayUserId;

  return (
    <div
      data-testid={`pvp-match-${match.id}`}
      className={`border px-3 py-2.5 text-xs ${
        mine ? 'border-cyber-500/60 bg-cyber-400/5' : 'border-ink-600/70 bg-ink-850/40'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate ${homeWon ? 'font-semibold text-good-400' : mine ? 'text-fg' : 'text-fg-muted'}`}
        >
          {teamLabel(match.homeUserId, meId, meName)}
        </span>
        <span className="tnum shrink-0 font-mono text-sm text-fg">
          {match.homeScore ?? '—'}
          <span className="mx-1 text-fg-faint">:</span>
          {match.awayScore ?? '—'}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-right ${awayWon ? 'font-semibold text-good-400' : 'text-fg-muted'}`}
        >
          {teamLabel(match.awayUserId, meId, meName)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="text-fg-dim">{matchStatusLabel(match.status)}</span>
        {match.reportUrl !== null && (
          <Link to={recordPath(match.reportUrl)} className="text-cyber-300 underline decoration-cyber-500/50">
            查看战报
          </Link>
        )}
      </div>
    </div>
  );
}

/** 单败对阵树：按轮次分列，自己所在场次高亮 */
export function BracketView({
  matches,
  meId,
  meName,
}: {
  matches: PvpMatchView[];
  meId: number | undefined;
  meName: string | undefined;
}): JSX.Element {
  const rounds = [...new Set(matches.map((match) => match.round))].sort((left, right) => left - right);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">对阵结果</h2>
        <span className="text-[11px] text-fg-dim">
          {rounds.length} 轮 · {matches.length} 场
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
        {rounds.map((round) => (
          <div key={round} className="space-y-2">
            <h3 className="eyebrow">第 {round} 轮</h3>
            {matches
              .filter((match) => match.round === round)
              .map((match) => (
                <MatchCard key={match.id} match={match} meId={meId} meName={meName} />
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}
