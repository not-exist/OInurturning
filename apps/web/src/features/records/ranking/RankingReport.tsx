import type { JSX } from 'react';
import type {
  ContestReport,
  ContestTeam,
  ParticipantTimeline,
  QuestionSnapshot,
} from '@oinur/shared';
import { Metric, VerdictBadge } from '../shared/bits';
import { dimensionLabel, floor, signed } from '../../../lib/labels';

type RankingReportData = Extract<ContestReport, { format: 'RANKING' }>;

/** 队名：由成员名组合（NPC 队伍也会给出成员名） */
export function teamName(team: ContestTeam): string {
  return team.members.map((member) => member.displayName).join('、');
}

/** 名次色阶（冠军电光青，其余按名次降调；不借稀有度六色） */
function rankTone(rank: number | undefined): string {
  if (rank === 1) return 'text-cyber-300';
  if (rank !== undefined && rank <= 3) return 'text-cyber-500';
  return 'text-fg-muted';
}

/** 排名赛按队伍切分扁平的 participants（顺序恒为 teams.flatMap(members)） */
function teamTimelines(report: RankingReportData): {
  teamIndex: number;
  team: ContestTeam;
  timelines: ParticipantTimeline[];
}[] {
  let offset = 0;
  return report.teams.map((team, teamIndex) => {
    const timelines = report.participants.slice(offset, offset + team.members.length);
    offset += team.members.length;
    return { teamIndex, team, timelines };
  });
}

function TimelineRow({
  timeline,
  questions,
}: {
  timeline: ParticipantTimeline;
  questions: Map<number, QuestionSnapshot>;
}): JSX.Element {
  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-fg">{timeline.participant.displayName}</span>
        <span className="text-[11px] text-fg-dim">
          精力 -{floor(timeline.totalEnergySpent)} · 心态 {signed(timeline.finalMindset)}
        </span>
      </div>
      {timeline.attempts.length === 0 ? (
        <p className="mt-1 text-[11px] text-fg-faint">本场未作答。</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {timeline.attempts.map((attempt) => (
            <li
              key={attempt.problemInstanceId}
              className="flex flex-wrap items-center gap-2 text-[11px]"
            >
              <span className="w-14 text-fg-dim">第 {attempt.questionIndex + 1} 题</span>
              <span className="w-16 truncate text-fg-muted">
                {questions.get(attempt.questionIndex) === undefined
                  ? '—'
                  : dimensionLabel(questions.get(attempt.questionIndex)!.dimension)}
              </span>
              <VerdictBadge verdict={attempt.verdict} />
              <span className="tnum ml-auto text-fg-muted">{Math.ceil(attempt.minutesUsed)} 分钟</span>
              {attempt.penaltyMin > 0 && (
                <span className="tnum text-warn-400">罚时 +{Math.ceil(attempt.penaltyMin)}</span>
              )}
              <span className="tnum text-fg-dim">精力 -{floor(attempt.energyCost)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 排名赛战报：名次榜 + 逐队解题时间线 */
export function RankingReport({ report }: { report: RankingReportData }): JSX.Element {
  const mine = report.standings.find((standing) => standing.teamIndex === 0);
  const teams = teamTimelines(report);
  const questions = new Map(report.questions.map((question) => [question.index, question]));
  const attempts = (teams[0]?.timelines ?? []).flatMap((timeline) => timeline.attempts);
  const passed = attempts.filter((attempt) => attempt.verdict === 'AC').length;
  const skipped = attempts.filter((attempt) => attempt.verdict === 'SKIP').length;
  const unfinished = attempts.filter((attempt) => attempt.verdict === 'UNFINISHED').length;

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-4">
        <Metric label="最终名次" value={`#${mine?.rank ?? '—'}`} tone={rankTone(mine?.rank)} />
        <Metric label="总分" value={mine?.totalScore ?? 0} />
        <Metric label="参赛队伍" value={report.teams.length} />
        <Metric
          label="通关判定"
          value={report.pass ? '达成通关线' : '未达通关线'}
          tone={report.pass ? 'text-good-400' : 'text-warn-400'}
        />
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">名次榜</h2>
          <span className="text-[11px] text-fg-dim">
            通过 {passed}
            {skipped > 0 ? ` · 跳过 ${skipped}` : ''}
            {unfinished > 0 ? ` · 未完成 ${unfinished}` : ''}
          </span>
        </div>
        <ol className="divide-y divide-ink-600/60 border-y border-ink-600/60">
          {report.standings.map((standing) => {
            const team = report.teams[standing.teamIndex];
            const isMine = standing.teamIndex === 0;
            return (
              <li
                key={standing.teamIndex}
                className={`flex items-center gap-3 px-3 py-2.5 ${isMine ? 'bg-cyber-400/10' : ''}`}
              >
                <span className={`numeral w-8 shrink-0 text-center text-lg ${rankTone(standing.rank)}`}>
                  {standing.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {team === undefined ? '未知队伍' : teamName(team)}
                  {isMine && <span className="ml-2 text-[11px] text-cyber-300">我方</span>}
                </span>
                <span className="tnum shrink-0 text-sm font-semibold text-fg">
                  {standing.totalScore}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">答题时间线</h2>
        <div className="space-y-3">
          {teams.map(({ teamIndex, team, timelines }) => (
            <div
              key={teamIndex}
              className={`border ${teamIndex === 0 ? 'border-cyber-500/50' : 'border-ink-600/70'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600/60 bg-ink-850/50 px-3 py-2">
                <span className="min-w-0 truncate text-xs font-medium text-fg">{teamName(team)}</span>
                {teamIndex === 0 && <span className="text-[11px] text-cyber-300">我方</span>}
              </div>
              <div className="divide-y divide-ink-600/40">
                {timelines.map((timeline) => (
                  <TimelineRow
                    key={timeline.participant.displayName}
                    timeline={timeline}
                    questions={questions}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
