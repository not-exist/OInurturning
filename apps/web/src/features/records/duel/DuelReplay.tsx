import { useMemo, type JSX } from 'react';
import { Swords } from 'lucide-react';
import type { BattleReplayEvent } from '@oinur/shared';
import { Icon } from '../../../components/icons';
import { Numeral } from '../../../components/ui';
import { contestSideLabel, roundReasonLabel } from '../../../lib/labels';
import { FinishedPanel } from '../shared/FinishedPanel';
import { ReplayControls } from '../shared/ReplayControls';
import { ReplayStatus } from '../shared/bits';
import { useIncrementalReplay } from '../shared/useIncrementalReplay';
import { useReplayPlayback } from '../shared/useReplayPlayback';
import {
  buildTimedEvents,
  eventHeadline,
  finishEvent,
  matchupOf,
  type ReplayViewProps,
} from '../shared/replay';
import { LiveEvent } from './LiveEvent';

interface RoundMark {
  roundNo: number;
  solved: boolean;
  reason: string;
  awardedTo: 'HOME' | 'AWAY';
  score: number;
}

interface DuelState {
  home: number;
  away: number;
  round: number;
  rounds: RoundMark[];
  tiebreak: string | null;
}

/** 单事件推进：比分牌与逐局战绩（2N 局轮换，谁拿下哪局一目了然） */
function applyDuelEvent(state: DuelState, event: BattleReplayEvent): void {
  switch (event.type) {
    case 'ROUND_RESULT':
      state.home = event.homeScore;
      state.away = event.awayScore;
      state.round = event.roundNo;
      state.rounds.push({
        roundNo: event.roundNo,
        solved: event.solved,
        reason: event.reason,
        awardedTo: event.scoreAwardedTo,
        score: event.scoreAwarded,
      });
      break;
    case 'TIEBREAK':
      state.tiebreak = event.decidedBy;
      break;
    case 'BATTLE_FINISH':
      state.home = event.homeScore ?? state.home;
      state.away = event.awayScore ?? state.away;
      break;
    default:
      break;
  }
}

/** 对决转播（DUEL；旧格式排名赛也走单面板） */
export function DuelReplay({
  replay,
  onOpenReport,
  onReturn,
  onFinished,
}: ReplayViewProps): JSX.Element {
  const events = replay.events;
  const timeline = useMemo(() => buildTimedEvents(events), [events]);
  const matchup = useMemo(() => matchupOf(events), [events]);
  const totalRounds = useMemo(
    () => events.filter((event) => event.type === 'ROUND_RESULT').length,
    [events],
  );
  const playback = useReplayPlayback(timeline, replay.recordId, onFinished);
  const state = useIncrementalReplay(
    timeline,
    playback.cursor,
    replay.recordId,
    () => ({ home: 0, away: 0, round: 0, rounds: [], tiebreak: null }) as DuelState,
    applyDuelEvent,
  );

  return (
    <div className="space-y-4">
      <section className="panel panel-corners overflow-hidden">
        <header className="border-b border-ink-600/70 bg-ink-900/80 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">
                {replay.format === 'DUEL' ? 'Duel Battle' : 'Ranking Battle · Single View'}
              </p>
              <h1 className="mt-1 truncate text-2xl font-semibold">{replay.title}</h1>
            </div>
            <ReplayStatus
              finished={playback.finished}
              paused={playback.paused}
              runningLabel="战斗进行中"
            />
          </div>
          <div className="mt-3 h-0.5 bg-ink-700">
            <div
              className="h-full bg-cyber-400 transition-[width] duration-300"
              style={{ width: `${playback.progress}%` }}
            />
          </div>
        </header>

        <div className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3 border border-ink-600/70 bg-ink-900/60 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{contestSideLabel('HOME')}</p>
              <p className="truncate text-sm font-medium text-fg">{matchup?.home ?? '我方队伍'}</p>
            </div>
            <div className="flex shrink-0 items-baseline gap-2">
              <Numeral value={state.home} className="text-4xl text-cyber-300" />
              <Icon icon={Swords} className="size-3.5 text-fg-faint" />
              <Numeral value={state.away} className="text-4xl text-fg-muted" />
            </div>
            <div className="min-w-0 flex-1 text-right">
              <p className="eyebrow">{contestSideLabel('AWAY')}</p>
              <p className="truncate text-sm font-medium text-fg">
                {matchup?.away ?? '对手队伍'}
              </p>
            </div>
          </div>

          {state.rounds.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {state.rounds.map((mark) => (
                <span
                  key={mark.roundNo}
                  className={`border px-1.5 py-0.5 font-mono text-[10px] ${
                    mark.awardedTo === 'HOME'
                      ? 'border-cyber-500/60 text-cyber-300'
                      : 'border-ink-600 text-fg-dim'
                  }`}
                >
                  第 {mark.roundNo} 局 · {mark.solved ? '答题成功' : roundReasonLabel(mark.reason)} ·{' '}
                  {contestSideLabel(mark.awardedTo)} +{mark.score}
                </span>
              ))}
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">
                {playback.finished
                  ? '转播已结束'
                  : state.round === 0
                    ? '开场'
                    : `第 ${state.round} / ${totalRounds} 局`}
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {playback.finished ? '本场战斗完成' : eventHeadline(playback.current)}
              </h2>
            </div>
            {!playback.finished && (
              <span className="text-[11px] text-fg-dim">
                {playback.paused ? '画面已定格' : '回放推进中'}
              </span>
            )}
          </div>

          {playback.finished ? (
            <FinishedPanel finish={finishEvent(events)} format={replay.format} />
          ) : (
            <LiveEvent event={playback.current} />
          )}
        </div>
      </section>

      <ReplayControls
        finished={playback.finished}
        paused={playback.paused}
        speed={playback.speed}
        recordId={replay.recordId}
        onTogglePause={playback.togglePause}
        onSkip={playback.skip}
        onSpeedChange={playback.setSpeed}
        onOpenReport={onOpenReport}
        onReturn={onReturn}
      />
    </div>
  );
}
