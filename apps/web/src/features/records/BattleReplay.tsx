import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { BattleReplay as BattleReplayData, BattleReplayEvent } from '@oinur/shared';

const SPEEDS = [1, 2, 4, 8] as const;
const BASE_PLAYBACK_RATE = 0.5;

type ReplaySpeed = (typeof SPEEDS)[number];

const VERDICT_LABEL: Record<string, string> = {
  AC: '通过',
  WA: '答案错误',
  TLE: '判题超时',
  UNFINISHED: '未完成',
  SKIP: '跳过',
};

const DIMENSION_LABEL: Record<string, string> = {
  DS: '数据结构',
  DP: '动态规划',
  MATH: '数学',
  GRAPH: '图论',
  GREEDY: '贪心',
  STRING: '字符串',
};

const SIDE_LABEL: Record<string, string> = {
  HOME: '主场',
  AWAY: '客场',
};

function formatMinutes(minutes: number): string {
  return `${Math.ceil(minutes)} 分钟`;
}

function verdictClass(verdict: string): string {
  if (verdict === 'AC') return 'bg-green-100 text-green-800';
  if (verdict === 'WA') return 'bg-yellow-100 text-yellow-800';
  if (verdict === 'TLE') return 'bg-neutral-200 text-neutral-700';
  return 'bg-red-100 text-red-800';
}

function eventHeadline(event: BattleReplayEvent): string {
  switch (event.type) {
    case 'BATTLE_START':
      return '战斗开始';
    case 'QUESTION_START':
      return `第 ${event.questionIndex + 1} 题`;
    case 'SUBMISSION':
      return `第 ${event.questionIndex + 1} 题 · 第 ${event.attemptNumber} 次提交`;
    case 'QUESTION_RESULT':
      return `第 ${event.questionIndex + 1} 题结算`;
    case 'ROUND_START':
      return `第 ${event.roundNo} 局开始`;
    case 'ROUND_RESULT':
      return `第 ${event.roundNo} 局结算`;
    case 'TIEBREAK':
      return '平局裁决';
    case 'BATTLE_FINISH':
      return '战斗结算';
  }
}

export function BattleWaiting({
  label = '服务端正在模拟战斗，获取回放中…',
}: {
  label?: string;
}): JSX.Element {
  return (
    <div className="mx-auto flex min-h-[360px] max-w-4xl items-center justify-center">
      <section className="w-full rounded border border-neutral-300 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-800" />
        <h1 className="mt-4 text-xl font-semibold">正在准备战斗</h1>
        <p className="mt-2 text-sm text-neutral-500">{label}</p>
        <p className="mt-1 text-xs text-neutral-400">战斗回放返回后将自动播放。</p>
      </section>
    </div>
  );
}

/** 检测回放事件流是否携带 memberIndex（新格式 → 多面板；旧格式 → 单面板 fallback）。 */
function hasMemberIndex(replay: BattleReplayData): boolean {
  return replay.events.some(
    (event) =>
      (event.type === 'QUESTION_START' || event.type === 'SUBMISSION' || event.type === 'QUESTION_RESULT') &&
      event.memberIndex !== undefined,
  );
}

export function BattleReplay({
  replay,
  onOpenReport,
  onReturn,
  onFinished,
}: {
  replay: BattleReplayData;
  onOpenReport?: (recordId: string) => void;
  onReturn?: () => void;
  onFinished?: () => void;
}): JSX.Element {
  if (replay.format === 'RANKING' && hasMemberIndex(replay)) {
    return (
      <RankingParallelReplay
        replay={replay}
        onOpenReport={onOpenReport}
        onReturn={onReturn}
        onFinished={onFinished}
      />
    );
  }
  return (
    <DuelReplay
      replay={replay}
      onOpenReport={onOpenReport}
      onReturn={onReturn}
      onFinished={onFinished}
    />
  );
}

// ---------------------------------------------------------------------------
// 排名赛并行回放
// ---------------------------------------------------------------------------

interface MemberPanelState {
  memberIndex: number;
  displayName: string;
  currentQuestionIndex: number | null;
  currentDimension: string | null;
  currentProblemId: string | null;
  currentScore: number | null;
  phase: 'IDLE' | 'THINKING' | 'SUBMITTING' | 'DONE';
  submissions: { attemptNo: number; verdict: string; timeMin: number; penaltyMin: number }[];
  questionVerdict: string | null;
  totalScore: number;
  energyAfter: number;
  focusAfter: number;
  mindsetAfter: number;
  notes: string[];
}

function createEmptyMemberState(memberIndex: number, displayName: string): MemberPanelState {
  return {
    memberIndex,
    displayName,
    currentQuestionIndex: null,
    currentDimension: null,
    currentProblemId: null,
    currentScore: null,
    phase: 'IDLE',
    submissions: [],
    questionVerdict: null,
    totalScore: 0,
    energyAfter: 0,
    focusAfter: 0,
    mindsetAfter: 0,
    notes: [],
  };
}

/** 按 memberIndex 更新成员面板状态（不可变更新）。 */
function applyEventToMembers(
  states: Map<number, MemberPanelState>,
  event: BattleReplayEvent,
): Map<number, MemberPanelState> {
  if (
    event.type !== 'QUESTION_START' &&
    event.type !== 'SUBMISSION' &&
    event.type !== 'QUESTION_RESULT'
  ) {
    return states;
  }
  const mi = event.memberIndex;
  if (mi === undefined) return states;

  const existing = states.get(mi);
  if (existing === undefined) return states;

  const next = new Map(states);

  switch (event.type) {
    case 'QUESTION_START': {
      next.set(mi, {
        ...existing,
        currentQuestionIndex: event.questionIndex,
        currentDimension: event.dimension,
        currentProblemId: event.problemInstanceId,
        currentScore: event.score,
        phase: 'THINKING',
        submissions: [],
        questionVerdict: null,
        notes: [],
      });
      break;
    }
    case 'SUBMISSION': {
      next.set(mi, {
        ...existing,
        phase: 'SUBMITTING',
        submissions: [
          ...existing.submissions,
          {
            attemptNo: event.attemptNumber,
            verdict: event.verdict,
            timeMin: event.submissionTimeMin,
            penaltyMin: event.penaltyMin,
          },
        ],
      });
      break;
    }
    case 'QUESTION_RESULT': {
      next.set(mi, {
        ...existing,
        phase: 'DONE',
        questionVerdict: event.verdict,
        totalScore: event.totalScore,
        energyAfter: event.energyAfter,
        focusAfter: event.focusAfter,
        mindsetAfter: event.mindsetAfter,
        notes: event.notes,
      });
      break;
    }
  }
  return next;
}

function RankingParallelReplay({
  replay,
  onOpenReport,
  onReturn,
  onFinished,
}: {
  replay: BattleReplayData;
  onOpenReport?: (recordId: string) => void;
  onReturn?: () => void;
  onFinished?: () => void;
}): JSX.Element {
  const events = replay.events;
  const [cursor, setCursor] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [finished, setFinished] = useState(false);
  const [memberStates, setMemberStates] = useState<Map<number, MemberPanelState>>(new Map());

  const current = events[cursor];
  const finish = events.at(-1)?.type === 'BATTLE_FINISH' ? events.at(-1) : undefined;

  // 从事件流中收集队员元信息（memberIndex → displayName）。
  const memberMeta = useMemo(() => {
    const meta = new Map<number, string>();
    for (const event of events) {
      if (
        (event.type === 'QUESTION_START' || event.type === 'SUBMISSION' || event.type === 'QUESTION_RESULT') &&
        event.memberIndex !== undefined &&
        !meta.has(event.memberIndex)
      ) {
        meta.set(event.memberIndex, event.participantName);
      }
    }
    return meta;
  }, [events]);

  // 用 ref 跟踪上一次处理的 cursor，避免重复 apply。
  const lastProcessedRef = useRef(-1);

  // 重置状态（切换回放时）。
  useEffect(() => {
    setCursor(0);
    setPaused(false);
    setFinished(false);
    setMemberStates(new Map());
    lastProcessedRef.current = -1;
  }, [replay.recordId]);

  // 初始化成员面板（从 memberMeta 构建初始空状态）。
  useEffect(() => {
    if (memberMeta.size === 0) return;
    setMemberStates((prev) => {
      if (prev.size > 0) return prev;
      const initial = new Map<number, MemberPanelState>();
      for (const [mi, name] of memberMeta) {
        initial.set(mi, createEmptyMemberState(mi, name));
      }
      return initial;
    });
  }, [memberMeta]);

  // 处理当前事件：更新对应成员面板。
  useEffect(() => {
    if (cursor === lastProcessedRef.current) return;
    lastProcessedRef.current = cursor;
    const event = events[cursor];
    if (event === undefined) return;
    setMemberStates((prev) => applyEventToMembers(prev, event));
  }, [cursor, events]);

  // 自动推进游标。
  useEffect(() => {
    if (paused || finished || current === undefined) return undefined;
    const effectiveSpeed = speed * BASE_PLAYBACK_RATE;
    const duration = Math.max(100, current.durationMs / effectiveSpeed);
    const timer = window.setTimeout(() => {
      if (cursor + 1 < events.length) {
        setCursor((value) => value + 1);
      } else {
        setFinished(true);
      }
    }, duration);
    return () => window.clearTimeout(timer);
  }, [cursor, current, events.length, finished, paused, speed]);

  useEffect(() => {
    if (finished) onFinished?.();
  }, [finished, onFinished]);

  const handleSkip = useCallback(() => {
    // 跳过时一次性处理所有剩余事件，确保成员面板状态完整。
    for (let i = cursor; i < events.length; i++) {
      const event = events[i]!;
      setMemberStates((prev) => applyEventToMembers(prev, event));
    }
    setCursor(Math.max(events.length - 1, 0));
    setFinished(true);
  }, [cursor, events]);

  if (events.length === 0) {
    return (
      <section className="rounded border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        回放数据为空，无法开始战斗演示。
      </section>
    );
  }

  const progress = finished ? 100 : Math.round(((cursor + 1) / events.length) * 100);
  const sortedMembers = [...memberStates.values()].sort((a, b) => a.memberIndex - b.memberIndex);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* 顶部标题栏 */}
      <section className="overflow-hidden rounded border border-neutral-300 bg-white shadow-sm">
        <div className="border-b bg-neutral-950 px-5 py-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                Ranking Battle · Parallel View
              </p>
              <h1 className="mt-1 text-2xl font-semibold">{replay.title}</h1>
            </div>
            <span className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300">
              {finished ? '战斗结束' : paused ? '已暂停' : '战斗进行中'}
            </span>
          </div>
          {current?.type === 'BATTLE_START' && (
            <p className="mt-4 text-sm text-neutral-300">
              {current.homeName}
              {current.awayName === undefined ? '' : ` 对阵 ${current.awayName}`}
            </p>
          )}
        </div>

        <div className="h-1 bg-neutral-200">
          <div
            className="h-full bg-blue-600 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">
                {finished
                  ? 'Final Result'
                  : `Event ${Math.min(cursor + 1, events.length)} / ${events.length}`}
              </p>
              <h2 className="mt-1 text-xl font-semibold">
                {finished ? '本场战斗完成' : current === undefined ? '准备中…' : '队员并行作战中'}
              </h2>
            </div>
            {!finished && current !== undefined && (
              <span className="rounded bg-neutral-100 px-3 py-1 text-sm text-neutral-600">
                回放中
              </span>
            )}
          </div>

          {/* BATTLE_START / BATTLE_FINISH 全宽展示 */}
          {current?.type === 'BATTLE_START' && !finished && (
            <div className="mb-5 rounded border border-blue-200 bg-blue-50 p-6 text-center">
              <p className="text-4xl">⚔️</p>
              <p className="mt-3 text-lg font-semibold">{current.homeName}</p>
              {current.awayName !== undefined && (
                <p className="mt-1 text-sm text-neutral-600">VS {current.awayName}</p>
              )}
              <p className="mt-3 text-sm text-blue-800">双方准备完毕，比赛即将开始。</p>
            </div>
          )}

          {/* 结算面板 */}
          {finished && <FinishedPanel finish={finish} format={replay.format} />}

          {/* 多面板并行展示 */}
          {!finished && current?.type !== 'BATTLE_START' && (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: `repeat(${Math.min(sortedMembers.length, 4)}, minmax(0, 1fr))`,
              }}
            >
              {sortedMembers.map((state) => (
                <MemberPanel key={state.memberIndex} state={state} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 控制栏 */}
      <ReplayControls
        finished={finished}
        paused={paused}
        speed={speed}
        recordId={replay.recordId}
        onTogglePause={() => setPaused((value) => !value)}
        onSkip={handleSkip}
        onSpeedChange={setSpeed}
        onOpenReport={onOpenReport}
        onReturn={onReturn}
      />
    </div>
  );
}

function MemberPanel({ state }: { state: MemberPanelState }): JSX.Element {
  return (
    <div
      className={`rounded border p-4 transition-colors duration-200 ${
        state.phase === 'IDLE'
          ? 'border-neutral-200 bg-neutral-50'
          : state.phase === 'DONE'
            ? state.questionVerdict === 'AC'
              ? 'border-green-300 bg-green-50'
              : 'border-amber-300 bg-amber-50'
            : 'border-blue-300 bg-blue-50'
      }`}
    >
      {/* 成员名与状态标识 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{state.displayName}</span>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
            state.phase === 'IDLE'
              ? 'bg-neutral-200 text-neutral-600'
              : state.phase === 'DONE'
                ? state.questionVerdict === 'AC'
                  ? 'bg-green-200 text-green-800'
                  : 'bg-amber-200 text-amber-800'
                : 'bg-blue-200 text-blue-800'
          }`}
        >
          {state.phase === 'IDLE'
            ? '等待中'
            : state.phase === 'THINKING'
              ? '思考中'
              : state.phase === 'SUBMITTING'
                ? '编码中'
                : state.questionVerdict === 'AC'
                  ? '已通过'
                  : '已结算'}
        </span>
      </div>

      {/* 当前题目 */}
      {state.currentQuestionIndex !== null && (
        <div className="mb-3">
          <p className="text-lg font-bold">第 {state.currentQuestionIndex + 1} 题</p>
          <p className="text-xs text-neutral-600">
            {state.currentDimension !== null ? (DIMENSION_LABEL[state.currentDimension] ?? state.currentDimension) : ''}
            {state.currentScore !== null ? ` · ${state.currentScore} 分` : ''}
          </p>
        </div>
      )}

      {/* 提交记录 */}
      {state.submissions.length > 0 && (
        <div className="mb-3 space-y-1">
          {state.submissions.map((sub) => (
            <div key={sub.attemptNo} className="flex items-center justify-between text-xs">
              <span className="text-neutral-600">#{sub.attemptNo}</span>
              <span
                className={`rounded px-1.5 py-0.5 font-medium ${
                  sub.verdict === 'AC' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}
              >
                {VERDICT_LABEL[sub.verdict] ?? sub.verdict}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 题目结算后的数据 */}
      {state.phase === 'DONE' && (
        <div className="space-y-1 border-t border-neutral-200 pt-2 text-xs text-neutral-700">
          <div className="flex justify-between">
            <span>得分</span>
            <span className="font-semibold">{state.totalScore}</span>
          </div>
          <div className="flex justify-between">
            <span>精力</span>
            <span>{Math.floor(state.energyAfter)}</span>
          </div>
          <div className="flex justify-between">
            <span>专注</span>
            <span>{Math.floor(state.focusAfter)}</span>
          </div>
          <div className="flex justify-between">
            <span>心态</span>
            <span>
              {state.mindsetAfter > 0 ? '+' : ''}
              {state.mindsetAfter}
            </span>
          </div>
          {state.notes.length > 0 && (
            <p className="text-neutral-500">{state.notes.join('、')}</p>
          )}
        </div>
      )}

      {/* 等待中的占位 */}
      {state.phase === 'IDLE' && state.currentQuestionIndex === null && (
        <p className="text-xs text-neutral-400">等待比赛开始…</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 对决/通用单面板回放（DUEL 或旧格式 RANKING fallback）
// ---------------------------------------------------------------------------

function DuelReplay({
  replay,
  onOpenReport,
  onReturn,
  onFinished,
}: {
  replay: BattleReplayData;
  onOpenReport?: (recordId: string) => void;
  onReturn?: () => void;
  onFinished?: () => void;
}): JSX.Element {
  const [cursor, setCursor] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [finished, setFinished] = useState(false);
  const events = replay.events;
  const current = events[cursor];
  const finish = events.at(-1)?.type === 'BATTLE_FINISH' ? events.at(-1) : undefined;

  useEffect(() => {
    setCursor(0);
    setPaused(false);
    setFinished(false);
  }, [replay.recordId]);

  useEffect(() => {
    if (paused || finished || current === undefined) return undefined;
    const effectiveSpeed = speed * BASE_PLAYBACK_RATE;
    const duration = Math.max(100, current.durationMs / effectiveSpeed);
    const timer = window.setTimeout(() => {
      if (cursor + 1 < events.length) {
        setCursor((value) => value + 1);
      } else {
        setFinished(true);
      }
    }, duration);
    return () => window.clearTimeout(timer);
  }, [cursor, current, events.length, finished, paused, speed]);

  useEffect(() => {
    if (finished) onFinished?.();
  }, [finished, onFinished]);

  if (events.length === 0) {
    return (
      <section className="rounded border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        回放数据为空，无法开始战斗演示。
      </section>
    );
  }

  const progress = finished ? 100 : Math.round(((cursor + 1) / events.length) * 100);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="overflow-hidden rounded border border-neutral-300 bg-white shadow-sm">
        <div className="border-b bg-neutral-950 px-5 py-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                {replay.format === 'RANKING' ? 'Ranking Battle' : 'Duel Battle'}
              </p>
              <h1 className="mt-1 text-2xl font-semibold">{replay.title}</h1>
            </div>
            <span className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300">
              {finished ? '战斗结束' : paused ? '已暂停' : '战斗进行中'}
            </span>
          </div>
          {current?.type === 'BATTLE_START' && (
            <p className="mt-4 text-sm text-neutral-300">
              {current.homeName}
              {current.awayName === undefined ? '' : ` 对阵 ${current.awayName}`}
            </p>
          )}
        </div>

        <div className="h-1 bg-neutral-200">
          <div
            className="h-full bg-blue-600 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">
                {finished
                  ? 'Final Result'
                  : `Event ${Math.min(cursor + 1, events.length)} / ${events.length}`}
              </p>
              <h2 className="mt-1 text-xl font-semibold">
                {finished
                  ? '本场战斗完成'
                  : current === undefined
                    ? '准备中…'
                    : eventHeadline(current)}
              </h2>
            </div>
            {!finished && current !== undefined && (
              <span className="rounded bg-neutral-100 px-3 py-1 text-sm text-neutral-600">
                {current.type === 'BATTLE_FINISH' ? '正在确认最终结果…' : '回放中'}
              </span>
            )}
          </div>

          {finished ? (
            <FinishedPanel finish={finish} format={replay.format} />
          ) : (
            <LiveEvent event={current} />
          )}
        </div>
      </section>

      <ReplayControls
        finished={finished}
        paused={paused}
        speed={speed}
        recordId={replay.recordId}
        onTogglePause={() => setPaused((value) => !value)}
        onSkip={() => {
          setCursor(Math.max(events.length - 1, 0));
          setFinished(true);
        }}
        onSpeedChange={setSpeed}
        onOpenReport={onOpenReport}
        onReturn={onReturn}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 共享子组件
// ---------------------------------------------------------------------------

function ReplayControls({
  finished,
  paused,
  speed,
  recordId,
  onTogglePause,
  onSkip,
  onSpeedChange,
  onOpenReport,
  onReturn,
}: {
  finished: boolean;
  paused: boolean;
  speed: ReplaySpeed;
  recordId: string;
  onTogglePause: () => void;
  onSkip: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onOpenReport?: (recordId: string) => void;
  onReturn?: () => void;
}): JSX.Element {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          data-testid="replay-pause"
          className="rounded border border-neutral-300 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={finished}
          onClick={onTogglePause}
        >
          {paused ? '继续播放' : '暂停'}
        </button>
        {!finished && (
          <button
            type="button"
            data-testid="replay-skip"
            className="rounded border border-neutral-300 px-3 py-2"
            onClick={onSkip}
          >
            跳过回放
          </button>
        )}
        <span className="text-neutral-500">速度</span>
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`replay-speed-${value}x`}
            className={`rounded px-2.5 py-1.5 text-xs ${speed === value ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-700'}`}
            onClick={() => onSpeedChange(value)}
          >
            {value}x
          </button>
        ))}
      </div>
      {finished && (
        <div className="flex flex-wrap gap-2">
          {onOpenReport && (
            <button
              type="button"
              data-testid="replay-open-report"
              className="rounded bg-neutral-900 px-3 py-2 text-sm text-white"
              onClick={() => onOpenReport(recordId)}
            >
              查看完整战报
            </button>
          )}
          {onReturn && (
            <button
              type="button"
              data-testid="replay-back"
              className="rounded border border-neutral-300 px-3 py-2 text-sm"
              onClick={onReturn}
            >
              返回
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function LiveEvent({ event }: { event: BattleReplayEvent | undefined }): JSX.Element {
  if (event === undefined) return <p className="text-sm text-neutral-500">正在准备回放…</p>;

  switch (event.type) {
    case 'BATTLE_START':
      return (
        <div className="rounded border border-blue-200 bg-blue-50 p-6 text-center">
          <p className="text-4xl">⚔️</p>
          <p className="mt-3 text-lg font-semibold">{event.homeName}</p>
          {event.awayName !== undefined && (
            <p className="mt-1 text-sm text-neutral-600">VS {event.awayName}</p>
          )}
          <p className="mt-3 text-sm text-blue-800">双方准备完毕，比赛即将开始。</p>
        </div>
      );
    case 'QUESTION_START':
      return (
        <div className="space-y-4">
          <div className="rounded border border-blue-200 bg-blue-50 p-5">
            <p className="text-sm text-blue-800">{event.participantName} 正在处理题目</p>
            <p className="mt-2 text-2xl font-semibold">第 {event.questionIndex + 1} 题</p>
            <p className="mt-2 text-sm text-neutral-700">
              {DIMENSION_LABEL[event.dimension] ?? event.dimension} · {event.problemInstanceId} ·{' '}
              {event.score} 分
            </p>
          </div>
          <p className="text-center text-sm text-neutral-500">分析题意与构思解法中…</p>
        </div>
      );
    case 'SUBMISSION':
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded border border-neutral-200 bg-neutral-50 p-4">
            <span className="text-sm text-neutral-600">{event.participantName} 提交代码</span>
            <span className="rounded bg-neutral-900 px-2 py-1 text-xs text-white">
              #{event.attemptNumber}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="判定" value={VERDICT_LABEL[event.verdict] ?? event.verdict} />
            <Metric label="提交时间" value={formatMinutes(event.submissionTimeMin)} />
            <Metric label="罚时" value={formatMinutes(event.penaltyMin)} />
          </div>
          {event.clockExhausted && <p className="text-sm text-red-700">比赛时钟已耗尽。</p>}
        </div>
      );
    case 'QUESTION_RESULT':
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className={`rounded px-3 py-1 text-sm font-medium ${verdictClass(event.verdict)}`}
            >
              {VERDICT_LABEL[event.verdict] ?? event.verdict}
            </span>
            <span className="text-sm text-neutral-500">{event.participantName}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="本题用时" value={formatMinutes(event.timeSpentMin)} />
            <Metric label="当前得分" value={String(event.totalScore)} />
            <Metric label="剩余精力" value={String(Math.floor(event.energyAfter))} />
            <Metric label="当前专注" value={String(Math.floor(event.focusAfter))} />
          </div>
          <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
            心态：{event.mindsetAfter > 0 ? '+' : ''}
            {event.mindsetAfter}
            {event.penaltyMin > 0 ? ` · 罚时 ${formatMinutes(event.penaltyMin)}` : ''}
            {event.notes.length > 0 ? ` · ${event.notes.join('、')}` : ''}
          </div>
        </div>
      );
    case 'ROUND_START':
      return (
        <div className="rounded border border-purple-200 bg-purple-50 p-6 text-center">
          <p className="text-sm text-purple-800">第 {event.roundNo} 局</p>
          <p className="mt-2 text-xl font-semibold">
            {event.setterName} 出题 → {SIDE_LABEL[event.answererSide]}答题
          </p>
          <p className="mt-3 text-sm text-neutral-600">{event.participantName} 正在接战</p>
          <p className="mt-1 text-xs text-neutral-500">题目 {event.questionInstanceId}</p>
        </div>
      );
    case 'ROUND_RESULT':
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className={`rounded px-3 py-1 text-sm font-medium ${event.solved ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}
            >
              {event.solved ? '答题成功' : (VERDICT_LABEL[event.reason] ?? event.reason)}
            </span>
            <span className="text-sm text-neutral-500">
              {event.setterName} 出题 → {event.answererName} 答题
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="本局得分"
              value={`${SIDE_LABEL[event.scoreAwardedTo]} +${event.scoreAwarded}`}
            />
            <Metric label="用时" value={formatMinutes(event.timeSpentMin)} />
            <Metric label="精力消耗" value={`-${Math.floor(event.energyCost)}`} />
          </div>
          <div className="rounded border border-neutral-900 bg-neutral-900 p-5 text-center text-white">
            <p className="text-xs text-neutral-400">当前比分</p>
            <p className="mt-1 text-3xl font-semibold">
              {event.homeScore} : {event.awayScore}
            </p>
          </div>
        </div>
      );
    case 'TIEBREAK':
      return (
        <div className="rounded border border-amber-200 bg-amber-50 p-5">
          <p className="font-semibold text-amber-900">常规赛平局，进入裁决</p>
          <p className="mt-2 text-sm text-amber-800">裁决方式：{event.decidedBy}</p>
          {event.trail.length > 0 && (
            <p className="mt-2 text-sm text-neutral-700">裁决链：{event.trail.join(' → ')}</p>
          )}
        </div>
      );
    case 'BATTLE_FINISH':
      return (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-6 text-center">
          <p className="text-2xl">🏁</p>
          <p className="mt-3 font-semibold">最终结果确认中…</p>
          <p className="mt-1 text-sm text-neutral-500">请等待回放完成。</p>
        </div>
      );
  }
}

function FinishedPanel({
  finish,
  format,
}: {
  finish: BattleReplayEvent | undefined;
  format: BattleReplayData['format'];
}): JSX.Element {
  if (finish === undefined || finish.type !== 'BATTLE_FINISH') {
    return <p className="text-sm text-red-600">回放结束事件缺失。</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-green-200 bg-green-50 p-5 text-center">
        <p className="text-3xl">🏁</p>
        {format === 'RANKING' ? (
          <>
            <p className="mt-2 text-xl font-semibold">第 {finish.rank ?? '-'} 名</p>
            <p className="mt-1 text-sm text-neutral-700">
              {finish.participantCount ?? '-'} 支队伍参赛 · 总分 {finish.totalScore ?? 0} ·{' '}
              {finish.pass ? '达成通关线' : '未达通关线'}
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-xl font-semibold">
              {finish.winnerSide === 'DRAW'
                ? '平局'
                : finish.winnerSide === 'HOME'
                  ? '主场获胜'
                  : '客场获胜'}
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {finish.homeScore ?? 0} : {finish.awayScore ?? 0}
            </p>
          </>
        )}
      </div>
      {(finish.rewards.length > 0 || finish.growth.length > 0) && (
        <div className="rounded border border-neutral-200 bg-white p-4 text-sm">
          <h3 className="font-medium">本场结算</h3>
          <div className="mt-2 space-y-1 text-neutral-700">
            {finish.rewards.map((reward, index) => (
              <p key={`${reward.type}-${index}`}>奖励：{reward.type}</p>
            ))}
            {finish.growth.map((growth, index) => (
              <p key={`${growth.attr}-${index}`}>
                实战成长：{growth.attr} +{growth.delta}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded border border-neutral-200 bg-white px-3 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
