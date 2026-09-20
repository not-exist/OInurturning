import type { JSX } from 'react';
import { Swords } from 'lucide-react';
import type { BattleReplayEvent } from '@oinur/shared';
import { Icon } from '../../../components/icons';
import { contestSideLabel, dimensionLabel, roundReasonLabel, tiebreakLabel } from '../../../lib/labels';
import { Metric, VerdictBadge } from '../shared/bits';
import { formatMinutes, trailLabel } from '../shared/replay';

/** 对决单面板转播：当前事件的特写镜头 */
export function LiveEvent({ event }: { event: BattleReplayEvent | undefined }): JSX.Element {
  if (event === undefined) return <p className="text-sm text-fg-dim">正在准备回放…</p>;

  switch (event.type) {
    case 'BATTLE_START':
      return (
        <div className="animate-rise border border-cyber-500/40 bg-cyber-400/5 px-5 py-7 text-center">
          <Icon icon={Swords} className="mx-auto size-6 text-cyber-400" />
          <p className="mt-3 text-lg font-semibold text-fg">{event.homeName}</p>
          <p className="my-1 font-mono text-[11px] tracking-[0.3em] text-fg-faint">VS</p>
          {event.awayName !== undefined && (
            <p className="text-lg font-semibold text-fg-muted">{event.awayName}</p>
          )}
          <p className="mt-4 text-xs text-fg-dim">双方准备完毕，第一局即将开始。</p>
        </div>
      );

    case 'QUESTION_START':
      return (
        <div className="animate-rise space-y-3">
          <div className="border border-cyber-500/40 bg-cyber-400/5 px-5 py-4">
            <p className="text-xs text-cyber-300">{event.participantName} 正在读题</p>
            <p className="mt-1.5 flex items-baseline gap-2">
              <span className="numeral text-3xl text-fg">{event.questionIndex + 1}</span>
              <span className="text-xs text-fg-dim">题</span>
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {dimensionLabel(event.dimension)} · {event.score} 分
            </p>
          </div>
          <p className="text-center text-xs text-fg-faint">分析题意与构思解法中…</p>
        </div>
      );

    case 'SUBMISSION':
      return (
        <div className="animate-rise space-y-3">
          <div className="flex items-center justify-between gap-3 border border-ink-600/70 bg-ink-850/50 px-4 py-3">
            <span className="text-sm text-fg-muted">{event.participantName} 提交代码</span>
            <span className="tnum border border-ink-600 px-2 py-0.5 font-mono text-xs text-fg-muted">
              #{event.attemptNumber}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Metric
              label="判定"
              value={<VerdictBadge verdict={event.verdict} />}
              tone="text-fg"
            />
            <Metric label="提交时间" value={formatMinutes(event.submissionTimeMin)} />
            <Metric
              label="罚时"
              value={event.penaltyMin > 0 ? `+${Math.ceil(event.penaltyMin)} 分钟` : '无'}
              tone={event.penaltyMin > 0 ? 'text-warn-400' : 'text-fg-muted'}
            />
          </div>
          {event.clockExhausted && <p className="text-xs text-bad-400">比赛时钟已耗尽，本局被迫收尾。</p>}
        </div>
      );

    case 'QUESTION_RESULT':
      return (
        <div className="animate-rise space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <VerdictBadge verdict={event.verdict} className="text-xs" />
            <span className="text-xs text-fg-muted">{event.participantName}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <Metric label="本题用时" value={formatMinutes(event.timeSpentMin)} />
            <Metric label="当前得分" value={event.totalScore} />
            <Metric label="剩余精力" value={Math.floor(event.energyAfter)} />
            <Metric label="当前专注" value={Math.floor(event.focusAfter)} />
          </div>
          <div className="border border-ink-600/70 bg-ink-850/50 px-3 py-2 text-xs text-fg-muted">
            心态{' '}
            <span className={event.mindsetAfter < 0 ? 'text-bad-400' : 'text-fg'}>
              {event.mindsetAfter > 0 ? '+' : ''}
              {event.mindsetAfter}
            </span>
            {event.penaltyMin > 0 && (
              <span className="text-warn-400"> · 罚时 {formatMinutes(event.penaltyMin)}</span>
            )}
            {event.notes.length > 0 && <span> · {event.notes.join('、')}</span>}
          </div>
        </div>
      );

    case 'ROUND_START':
      return (
        <div className="animate-rise border border-arc-400/40 bg-arc-400/5 px-5 py-5 text-center">
          <p className="eyebrow">第 {event.roundNo} 局</p>
          <p className="mt-2 text-base font-semibold text-fg">
            {event.setterName} 出题 → {contestSideLabel(event.answererSide)}作答
          </p>
          <p className="mt-1.5 text-xs text-fg-muted">{event.participantName} 接战</p>
        </div>
      );

    case 'ROUND_RESULT':
      return (
        <div className="animate-rise space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className={`border px-2.5 py-0.5 text-sm font-medium ${
                event.solved
                  ? 'border-good-400/60 bg-good-400/10 text-good-400'
                  : 'border-warn-400/50 bg-warn-400/10 text-warn-400'
              }`}
            >
              {event.solved ? '答题成功' : roundReasonLabel(event.reason)}
            </span>
            <span className="text-xs text-fg-muted">
              {event.setterName} 出题 → {event.answererName} 作答
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Metric
              label="本局得分"
              value={`${contestSideLabel(event.scoreAwardedTo)} +${event.scoreAwarded}`}
              tone={event.scoreAwardedTo === 'HOME' ? 'text-cyber-300' : 'text-fg-muted'}
            />
            <Metric label="用时" value={formatMinutes(event.timeSpentMin)} />
            <Metric
              label="精力消耗"
              value={`-${Math.floor(event.energyCost)}`}
              tone="text-warn-400"
            />
          </div>
        </div>
      );

    case 'TIEBREAK':
      return (
        <div className="animate-rise border border-warn-400/40 bg-warn-400/5 px-5 py-4">
          <p className="text-sm font-semibold text-warn-400">常规局战平，进入裁决</p>
          <p className="mt-1.5 text-xs text-fg-muted">
            裁决方式：{tiebreakLabel(event.decidedBy)}
          </p>
          {event.trail.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {event.trail.map((token) => (
                <span
                  key={token}
                  className="border border-ink-600 px-1.5 py-0.5 font-mono text-[10px] text-fg-dim"
                >
                  {trailLabel(token)}
                </span>
              ))}
            </div>
          )}
        </div>
      );

    case 'BATTLE_FINISH':
      return (
        <div className="animate-rise border border-ink-600/70 bg-ink-850/50 px-5 py-6 text-center">
          <p className="text-sm font-semibold text-fg-muted">最终结果确认中…</p>
          <p className="mt-1 text-xs text-fg-faint">转播即将收尾。</p>
        </div>
      );
  }
}
