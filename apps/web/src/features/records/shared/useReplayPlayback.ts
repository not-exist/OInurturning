import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BattleReplayEvent } from '@oinur/shared';
import { BASE_PLAYBACK_RATE, type ReplaySpeed, type TimedReplayEvent } from './replay';

export interface ReplayPlayback {
  /** 已应用到状态的事件条数 */
  cursor: number;
  /** 当前展示的事件（已应用的最后一条） */
  current: BattleReplayEvent | undefined;
  totalEvents: number;
  elapsedMs: number;
  totalMs: number;
  progress: number;
  finished: boolean;
  paused: boolean;
  speed: ReplaySpeed;
  setSpeed: (speed: ReplaySpeed) => void;
  togglePause: () => void;
  skip: () => void;
}

/**
 * 回放播放头：单一 rAF/定时器按事件时间轴推进，同一 timeMs 的事件成组应用
 * （多人并行进入同一阶段）。播放状态与视图无关，排名赛并行视图与对决单面板共用。
 */
export function useReplayPlayback(
  timeline: readonly TimedReplayEvent[],
  replayKey: string,
  onFinished?: () => void,
): ReplayPlayback {
  const [cursor, setCursor] = useState(0);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [finished, setFinished] = useState(false);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const totalMs = useMemo(
    () => Math.max(1, ...timeline.map(({ event, timeMs }) => timeMs + event.durationMs)),
    [timeline],
  );

  // 换场次（或重播同一场次）时重置播放头。
  useEffect(() => {
    setCursor(0);
    setPlayheadMs(0);
    setPaused(false);
    setFinished(false);
  }, [replayKey]);

  useEffect(() => {
    if (paused || finished) return undefined;
    const next = timeline[cursor];
    if (next === undefined) {
      setFinished(true);
      return undefined;
    }
    const delay = Math.max(40, (next.timeMs - playheadMs) / (speed * BASE_PLAYBACK_RATE));
    const timer = window.setTimeout(() => {
      const targetTime = next.timeMs;
      let advanced = cursor;
      while (advanced < timeline.length && timeline[advanced]!.timeMs <= targetTime) {
        advanced += 1;
      }
      setPlayheadMs(targetTime);
      setCursor(advanced);
      if (advanced >= timeline.length) setFinished(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [cursor, finished, paused, playheadMs, speed, timeline]);

  useEffect(() => {
    if (finished) onFinishedRef.current?.();
  }, [finished]);

  const skip = useCallback(() => {
    setCursor(timeline.length);
    setPlayheadMs(totalMs);
    setFinished(true);
  }, [timeline.length, totalMs]);

  const togglePause = useCallback(() => setPaused((value) => !value), []);
  const current = timeline[Math.max(0, cursor - 1)]?.event ?? timeline[0]?.event;

  return {
    cursor,
    current,
    totalEvents: timeline.length,
    elapsedMs: Math.min(playheadMs, totalMs),
    totalMs,
    progress: finished ? 100 : Math.round((Math.min(playheadMs, totalMs) / totalMs) * 100),
    finished,
    paused,
    speed,
    setSpeed,
    togglePause,
    skip,
  };
}
