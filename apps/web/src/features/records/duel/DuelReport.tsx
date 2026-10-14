import type { JSX } from 'react';
import type { ContestReport, ParticipantSnapshot } from '@oinur/shared';
import { Metric, VerdictBadge } from '../shared/bits';
import { contestSideLabel, dimensionLabel, tiebreakLabel } from '../../../lib/labels';
import { trailLabel } from '../shared/replay';

type DuelReportData = Extract<ContestReport, { format: 'DUEL' }>;
type DuelRound = DuelReportData['rounds'][number];

function memberName(members: ParticipantSnapshot[], index: number): string {
  return members[index]?.displayName ?? '未知队员';
}

function sideMembers(report: DuelReportData, side: 'HOME' | 'AWAY'): ParticipantSnapshot[] {
  return side === 'HOME' ? report.inputSnapshot.home.members : report.inputSnapshot.away.members;
}

function RoundRow({ report, round }: { report: DuelReportData; round: DuelRound }): JSX.Element {
  const setter = memberName(sideMembers(report, round.setterSide), round.setterMemberIndex);
  const answerer = memberName(sideMembers(report, round.answererSide), round.answererMemberIndex);
  const tierTone = round.question.tier === undefined ? 'text-fg-dim' : 'text-fg-muted';

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="numeral w-10 shrink-0 text-base text-fg">{round.roundNo}</span>
        <span className="min-w-0 truncate text-fg-muted">{setter} 出题</span>
        <span className="shrink-0 text-fg-faint">→</span>
        <span className="min-w-0 truncate text-fg">{answerer} 作答</span>
        <VerdictBadge verdict={round.reason} className="ml-auto" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className={`truncate ${tierTone}`}>{dimensionLabel(round.question.dimension)}</span>
        <span className="tnum text-fg-dim">{round.question.score} 分题</span>
        <span className="tnum text-fg-muted">用时 {Math.ceil(round.timeSpentMin)} 分钟</span>
        {round.penaltyMin > 0 && (
          <span className="tnum text-warn-400">罚时 +{Math.ceil(round.penaltyMin)}</span>
        )}
        <span className="tnum text-fg-dim">精力 -{Math.floor(round.energyCost)}</span>
        <span
          className={`tnum ml-auto ${round.scoreAwardedTo === 'HOME' ? 'text-cyber-300' : 'text-fg-muted'}`}
        >
          {contestSideLabel(round.scoreAwardedTo)} +{round.scoreAwarded}
        </span>
      </div>
    </li>
  );
}

/** 出题对决战报：比分 + 逐局回合记录 */
export function DuelReport({ report }: { report: DuelReportData }): JSX.Element {
  const winner =
    report.winnerSide === 'HOME' ? '我方胜' : report.winnerSide === 'AWAY' ? '对手胜' : '平局';

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="我方得分" value={report.scores.home} tone="text-cyber-300" />
        <Metric label="对手得分" value={report.scores.away} />
        <Metric
          label="胜负"
          value={winner}
          tone={report.winnerSide === 'HOME' ? 'text-good-400' : report.winnerSide === 'AWAY' ? 'text-bad-400' : 'text-fg-muted'}
        />
      </div>

      {report.decidedBy !== undefined && report.decidedBy !== 'REGULAR' && (
        <p className="border border-warn-400/40 bg-warn-400/5 px-3 py-2 text-xs text-warn-400">
          本场由{tiebreakLabel(report.decidedBy)}裁定
          {report.tiebreakTrail !== undefined && report.tiebreakTrail.length > 0
            ? `：${report.tiebreakTrail.map((token) => trailLabel(token)).join(' → ')}`
            : ''}
        </p>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">回合记录</h2>
          <span className="text-[11px] text-fg-dim">
            共 {report.rounds.length} 局 · {report.qualityRuleOn ? '出题质量规则生效' : '常规规则'}
          </span>
        </div>
        <ol className="divide-y divide-ink-600/60 border-y border-ink-600/60">
          {report.rounds.map((round) => (
            <RoundRow key={round.roundNo} report={report} round={round} />
          ))}
        </ol>
      </section>
    </div>
  );
}
