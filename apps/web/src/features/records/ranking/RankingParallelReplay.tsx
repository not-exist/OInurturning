import { useMemo, type JSX } from 'react';
import { Swords } from 'lucide-react';
import type { BattleReplayEvent } from '@oinur/shared';
import { Icon } from '../../../components/icons';
import { FinishedPanel } from '../shared/FinishedPanel';
import { ReplayControls } from '../shared/ReplayControls';
import { ReplayStatus } from '../shared/bits';
import { useIncrementalReplay } from '../shared/useIncrementalReplay';
import { useReplayPlayback } from '../shared/useReplayPlayback';
import { buildTimedEvents, finishEvent, matchupOf, questionMap, type ReplayViewProps } from '../shared/replay';
import {
  MemberPanel,
  applyMemberEvent,
  createEmptyMemberState,
  type MemberPanelState,
} from './MemberPanel';
import { QuestionBoard, applyEventToQuestionStatus, type QuestionStatus } from './QuestionBoard';

/** 对阵条：排名赛只有我方（NPC 队伍不产生队员事件） */
function MatchupStrip({ home, away }: { home: string; away?: string }): JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border border-ink-600/70 bg-ink-900/60 px-4 py-2.5">
      <span className="truncate text-sm font-semibold text-fg">{home}</span>
      {away !== undefined && (
        <>
          <Icon icon={Swords} className="size-4 shrink-0 text-fg-faint" />
          <span className="truncate text-sm text-fg-muted">{away}</span>
        </>
      )}
    </div>
  );
}

/** 排名赛并行转播：题目看板 + 队员面板矩阵 + 最终名次裁决 */
export function RankingParallelReplay({
  replay,
  onOpenReport,
  onReturn,
  onFinished,
}: ReplayViewProps): JSX.Element {
  const events = replay.events;
  const timeline = useMemo(() => buildTimedEvents(events), [events]);
  const questions = useMemo(() => questionMap(replay.questions), [replay.questions]);
  const matchup = useMemo(() => matchupOf(events), [events]);
  const playback = useReplayPlayback(timeline, replay.recordId, onFinished);

  // 队员元信息（memberIndex → 姓名）从事件流中收集一次。
  const memberMeta = useMemo(() => {
    const meta = new Map<number, string>();
    for (const event of events) {
      if (
        (event.type === 'QUESTION_START' ||
          event.type === 'SUBMISSION' ||
          event.type === 'QUESTION_RESULT') &&
        event.memberIndex !== undefined &&
        !meta.has(event.memberIndex)
      ) {
        meta.set(event.memberIndex, event.participantName);
      }
    }
    return meta;
  }, [events]);

  const memberStates = useIncrementalReplay(
    timeline,
    playback.cursor,
    replay.recordId,
    () => {
      const members = new Map<number, MemberPanelState>();
      for (const [memberIndex, displayName] of memberMeta) {
        members.set(memberIndex, createEmptyMemberState(memberIndex, displayName));
      }
      return members;
    },
    (members, event: BattleReplayEvent) => applyMemberEvent(members, event, questions),
  );

  const statuses = useIncrementalReplay(
    timeline,
    playback.cursor,
    replay.recordId,
    () => new Map<number, QuestionStatus>(),
    applyEventToQuestionStatus,
  );

  const members = [...memberStates.values()].sort((left, right) => left.memberIndex - right.memberIndex);
  const columns = Math.max(1, Math.min(members.length, 4));

  return (
    <div className="space-y-4">
      <section className="panel panel-corners overflow-hidden">
        <header className="border-b border-ink-600/70 bg-ink-900/80 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Ranking Battle · Parallel View</p>
              <h1 className="mt-1 truncate text-2xl font-semibold">{replay.title}</h1>
            </div>
            <ReplayStatus
              finished={playback.finished}
              paused={playback.paused}
              runningLabel="全员并行作战中"
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
          {matchup !== null && <MatchupStrip home={matchup.home} away={matchup.away} />}

          {replay.questions !== undefined && replay.questions.length > 0 && (
            <QuestionBoard questions={replay.questions} statuses={statuses} />
          )}

          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">
                {playback.finished
                  ? '转播已结束'
                  : `转播进度 ${Math.round(playback.elapsedMs / 1000)} / ${Math.round(playback.totalMs / 1000)} 秒`}
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {playback.finished ? '本场战斗完成' : '队员并行作战中'}
              </h2>
            </div>
            {!playback.finished && (
              <span className="text-[11px] text-fg-dim">
                {playback.paused ? '画面已定格' : '时间轴同步推进中'}
              </span>
            )}
          </div>

          {playback.finished ? (
            <FinishedPanel finish={finishEvent(events)} format={replay.format} />
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {members.map((state) => (
                <MemberPanel key={state.memberIndex} state={state} />
              ))}
            </div>
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
