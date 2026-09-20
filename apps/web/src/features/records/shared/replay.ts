import type { BattleReplay, BattleReplayEvent, QuestionSnapshot } from '@oinur/shared';

/**
 * 回放展示层的时间轴工具（纯函数，无 React 依赖）。
 * 回放只是「服务端编写的转播序列」，不参与任何结算判定。
 */

/** 可切换的播放倍速档位 */
export const SPEEDS = [1, 2, 4, 8] as const;
export type ReplaySpeed = (typeof SPEEDS)[number];

/** 1x 档的基准折算：几百毫秒的事件要铺开成几秒，转播节奏才立得住 */
export const BASE_PLAYBACK_RATE = 0.5;

/** 回放视图对外 props：路由入口 / 剧情 / 历练三处语义一致 */
export interface ReplayViewProps {
  replay: BattleReplay;
  onOpenReport?: (recordId: string) => void;
  onReturn?: () => void;
  onFinished?: () => void;
}

export interface TimedReplayEvent {
  event: BattleReplayEvent;
  timeMs: number;
}

export type FinishEvent = Extract<BattleReplayEvent, { type: 'BATTLE_FINISH' }>;

function replayEventTime(event: BattleReplayEvent): number | undefined {
  return 'timeMs' in event && typeof event.timeMs === 'number' ? event.timeMs : undefined;
}

/** 事件按时间轴排序；旧格式（未携带 timeMs）按各自 durationMs 顺序铺开 */
export function buildTimedEvents(events: readonly BattleReplayEvent[]): TimedReplayEvent[] {
  let legacyTimeMs = 0;
  return events
    .map((event) => {
      const timeMs = replayEventTime(event) ?? legacyTimeMs;
      legacyTimeMs += event.durationMs;
      return { event, timeMs };
    })
    .sort((left, right) => left.timeMs - right.timeMs || left.event.seq - right.event.seq);
}

/** 新格式排名赛回放携带 memberIndex（→ 并行多面板）；旧格式退化为单面板 */
export function hasMemberIndex(replay: BattleReplay): boolean {
  return replay.events.some(
    (event) =>
      (event.type === 'QUESTION_START' ||
        event.type === 'SUBMISSION' ||
        event.type === 'QUESTION_RESULT') &&
      event.memberIndex !== undefined,
  );
}

export function finishEvent(events: readonly BattleReplayEvent[]): FinishEvent | undefined {
  const last = events.at(-1);
  return last?.type === 'BATTLE_FINISH' ? last : undefined;
}

export function questionMap(
  questions: readonly QuestionSnapshot[] | undefined,
): Map<string, QuestionSnapshot> {
  return new Map((questions ?? []).map((question) => [question.instanceId, question]));
}

/** 转播字幕：事件标题（绝不出现裸枚举 key） */
export function eventHeadline(event: BattleReplayEvent | undefined): string {
  if (event === undefined) return '准备中…';
  switch (event.type) {
    case 'BATTLE_START':
      return '战斗即将开始';
    case 'QUESTION_START':
      return `第 ${event.questionIndex + 1} 题`;
    case 'SUBMISSION':
      return `第 ${event.questionIndex + 1} 题 · 第 ${event.attemptNumber} 次提交`;
    case 'QUESTION_RESULT':
      return `第 ${event.questionIndex + 1} 题结果`;
    case 'ROUND_START':
      return `第 ${event.roundNo} 局开始`;
    case 'ROUND_RESULT':
      return `第 ${event.roundNo} 局结果`;
    case 'TIEBREAK':
      return '平局裁决';
    case 'BATTLE_FINISH':
      return '最终结果';
  }
}

export function formatMinutes(minutes: number): string {
  return `${Math.ceil(minutes)} 分钟`;
}

/** 对阵双方名（取自 BATTLE_START 事件；排名赛只有我方） */
export function matchupOf(
  events: readonly BattleReplayEvent[],
): { home: string; away?: string } | null {
  const start = events.find((event) => event.type === 'BATTLE_START');
  if (start === undefined) return null;
  return start.awayName === undefined
    ? { home: start.homeName }
    : { home: start.homeName, away: start.awayName };
}

/** 裁决链 token（引擎直接落库的英文串）→ 中文；未知一律兜底 */
const TRAIL_LABEL: Record<string, string> = {
  quality: '出题质量比较',
  penalty: '罚时比较',
  'energy-tie': '精力持平',
  'quality-tie': '出题质量持平',
  friendly: '友谊裁决',
  sudden_death: '突然死亡加赛',
  energy: '精力余量',
};

export function trailLabel(raw: string): string {
  if (raw.startsWith('seed-parity:')) return `随机裁决（档 ${raw.slice('seed-parity:'.length)}）`;
  return TRAIL_LABEL[raw] ?? '附加裁决';
}
