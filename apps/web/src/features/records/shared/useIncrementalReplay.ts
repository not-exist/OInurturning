import { useRef } from 'react';
import type { BattleReplayEvent } from '@oinur/shared';
import type { TimedReplayEvent } from './replay';

/**
 * 增量重放：只把 (已应用游标, 当前游标] 区间的事件推进到既有状态上。
 *
 * 每 tick 从 0 重放全部事件是 O(n²)：并行赛 4 人 × 多题、对决 2N 局的事件数随回合线性增长，
 * 长局会明显掉帧。本实现语义：
 * - 同一游标重复渲染直接命中缓存（StrictMode 双渲染安全）；
 * - 游标回退（重播）或换场次（replayKey 变化）时重建。
 */
export function useIncrementalReplay<S>(
  timeline: readonly TimedReplayEvent[],
  cursor: number,
  replayKey: string,
  init: () => S,
  step: (state: S, event: BattleReplayEvent) => void,
): S {
  const box = useRef<{ key: string; applied: number; state: S } | null>(null);
  if (box.current === null || box.current.key !== replayKey || box.current.applied > cursor) {
    box.current = { key: replayKey, applied: 0, state: init() };
  }
  const current = box.current;
  if (current.applied < cursor) {
    const end = Math.min(cursor, timeline.length);
    for (let index = current.applied; index < end; index += 1) {
      const event = timeline[index]?.event;
      if (event !== undefined) step(current.state, event);
    }
    current.applied = end;
  }
  return current.state;
}
