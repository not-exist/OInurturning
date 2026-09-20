import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type {
  BattleReplay as BattleReplayData,
  BattleReplayEvent,
  QuestionSnapshot,
} from '@oinur/shared';
import {
  contestSideLabel,
  dimensionLabel,
  roundReasonLabel,
  tierLabel,
  verdictLabel,
} from '../../lib/labels';

const SPEEDS = [1, 2, 4, 8] as const;
const BASE_PLAYBACK_RATE = 0.5;

type ReplaySpeed = (typeof SPEEDS)[number];

const SEVERITY_LABEL: Record<string, string> = {
  red: '红',
  yellow: '黄',
  blue: '蓝',
  purple: '紫',
  black: '黑',
  colorful: '彩',
};

const SEVERITY_CLASS: Record<string, string> = {
  red: 'bg-red-100 text-red-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  blue: 'bg-blue-100 text-blue-800',
  purple: 'bg-purple-100 text-purple-800',
  black: 'bg-neutral-800 text-white',
  colorful: 'bg-gradient-to-r from-pink-100 to-indigo-100 text-fuchsia-800',
};

const HOOK_LABEL: Record<string, string> = {
  condition: '触发条件',
  time_k_mul: '耗时乘数',
  ac_prob_add: 'AC 概率加成',
  tle_prob_add: '判题 TLE 概率加成',
  wa_penalty_add: 'WA 罚时加成',
  submit_time_add: '提交用时加成',
  energy_cost_add: '精力消耗加成',
  energy_per_submit_add: '每次提交精力消耗',
  noise_sigma_add: '用时噪声 σ 加成',
  noise_sigma_mul: '用时噪声 σ 乘数',
  mindset_fail_add: '失败心态惩罚加成',
  partial_override: '部分分规则',
  think_weight_mul: '思维缺口权重乘数',
  prob_amplify: '概率放大',
};

const HOOK_CONDITION_LABEL: Record<string, string> = {
  first_problem: '队伍第一题',
  anti_ak: '防 AK（仅剩 1 题未过）',
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

interface TimedReplayEvent {
  event: BattleReplayEvent;
  timeMs: number;
}

function replayEventTime(event: BattleReplayEvent): number | undefined {
  return 'timeMs' in event && typeof event.timeMs === 'number' ? event.timeMs : undefined;
}

function buildTimedEvents(events: readonly BattleReplayEvent[]): TimedReplayEvent[] {
  let legacyTimeMs = 0;
  return events
    .map((event) => {
      const timeMs = replayEventTime(event) ?? legacyTimeMs;
      legacyTimeMs += event.durationMs;
      return { event, timeMs };
    })
    .sort((left, right) => left.timeMs - right.timeMs || left.event.seq - right.event.seq);
}

interface MemberPanelState {
  memberIndex: number;
  displayName: string;
  currentQuestionIndex: number | null;
  currentDimension: string | null;
  currentProblemId: string | null;
  currentScore: number | null;
  phase: 'READY' | 'THINKING' | 'SUBMITTING' | 'DONE';
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
    phase: 'READY',
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
  const timedEvents = useMemo(() => buildTimedEvents(events), [events]);
  const [eventCursor, setEventCursor] = useState(0);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [finished, setFinished] = useState(false);

  const current = timedEvents[Math.max(0, eventCursor - 1)]?.event ?? events[0];
  const finish = events.at(-1)?.type === 'BATTLE_FINISH' ? events.at(-1) : undefined;
  const totalDurationMs = Math.max(
    1,
    ...timedEvents.map(({ event, timeMs }) => timeMs + event.durationMs),
  );

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

  const memberStates = useMemo(() => {
    const states = new Map<number, MemberPanelState>();
    for (const [mi, name] of memberMeta) {
      states.set(mi, createEmptyMemberState(mi, name));
    }
    let next = states;
    for (let index = 0; index < eventCursor; index++) {
      const event = timedEvents[index]?.event;
      if (event !== undefined) next = applyEventToMembers(next, event);
    }
    return next;
  }, [eventCursor, memberMeta, timedEvents]);

  // 题目看板的队内协作状态（随播放进度更新）。
  const questionStatuses = useMemo(
    () => collectQuestionStatuses(timedEvents, eventCursor),
    [eventCursor, timedEvents],
  );

  // 重置状态（切换回放时）。
  useEffect(() => {
    setEventCursor(0);
    setPlayheadMs(0);
    setPaused(false);
    setFinished(false);
  }, [replay.recordId]);

  // 自动推进播放头。一次处理同一 timestamp 的所有事件，让多个成员真正并行进入同一阶段。
  useEffect(() => {
    if (paused || finished) return undefined;
    const nextTimed = timedEvents[eventCursor];
    if (nextTimed === undefined) {
      setFinished(true);
      return undefined;
    }

    const effectiveSpeed = speed * BASE_PLAYBACK_RATE;
    const delay = Math.max(40, (nextTimed.timeMs - playheadMs) / effectiveSpeed);
    const timer = window.setTimeout(() => {
      const targetTime = nextTimed.timeMs;
      let nextCursor = eventCursor;
      while (nextCursor < timedEvents.length && timedEvents[nextCursor]!.timeMs <= targetTime) {
        nextCursor += 1;
      }
      setPlayheadMs(targetTime);
      setEventCursor(nextCursor);
      if (nextCursor >= timedEvents.length) setFinished(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [eventCursor, finished, paused, playheadMs, speed, timedEvents]);

  useEffect(() => {
    if (finished) onFinished?.();
  }, [finished, onFinished]);

  const handleSkip = useCallback(() => {
    setEventCursor(timedEvents.length);
    setPlayheadMs(totalDurationMs);
    setFinished(true);
  }, [timedEvents.length, totalDurationMs]);

  if (events.length === 0) {
    return (
      <section className="rounded border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        回放数据为空，无法开始战斗演示。
      </section>
    );
  }

  const progress = finished ? 100 : Math.round((Math.min(playheadMs, totalDurationMs) / totalDurationMs) * 100);
  const sortedMembers = [...memberStates.values()].sort((a, b) => a.memberIndex - b.memberIndex);
  const gridColumns = Math.max(1, Math.min(sortedMembers.length, 4));

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
              {finished ? '战斗结束' : paused ? '已暂停' : '全员并行作战中'}
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
                  : `Timeline ${Math.min(Math.round(playheadMs), totalDurationMs)} / ${Math.round(totalDurationMs)} ms`}
              </p>
              <h2 className="mt-1 text-xl font-semibold">
                {finished ? '本场战斗完成' : current === undefined ? '准备中…' : '队员并行作战中'}
              </h2>
            </div>
            {!finished && current !== undefined && (
              <span className="rounded bg-neutral-100 px-3 py-1 text-sm text-neutral-600">
                同步回放中
              </span>
            )}
          </div>

          {/* 题目看板：位于战斗标题与学员作战面板之间，展示题目难度与具体数值 */}
          {replay.questions !== undefined && replay.questions.length > 0 && (
            <QuestionBoard questions={replay.questions} statuses={questionStatuses} />
          )}

          {/* BATTLE_START 全宽展示 */}
          {current?.type === 'BATTLE_START' && eventCursor <= 1 && !finished && (
            <div className="mb-5 rounded border border-blue-200 bg-blue-50 p-6 text-center">
              <p className="text-4xl">⚔️</p>
              <p className="mt-3 text-lg font-semibold">{current.homeName}</p>
              {current.awayName !== undefined && (
                <p className="mt-1 text-sm text-neutral-600">VS {current.awayName}</p>
              )}
              <p className="mt-3 text-sm text-blue-800">全员准备完毕，比赛即将并行开始。</p>
            </div>
          )}

          {/* 结算面板 */}
          {finished && <FinishedPanel finish={finish} format={replay.format} />}

          {/* 多面板并行展示 */}
          {!finished && !(current?.type === 'BATTLE_START' && eventCursor <= 1) && (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
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
      data-testid="replay-member-panel"
      data-member-index={state.memberIndex}
      className={`rounded border p-4 transition-colors duration-200 ${
        state.phase === 'READY'
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
            state.phase === 'READY'
              ? 'bg-neutral-200 text-neutral-600'
              : state.phase === 'DONE'
                ? state.questionVerdict === 'AC'
                  ? 'bg-green-200 text-green-800'
                  : 'bg-amber-200 text-amber-800'
                : 'bg-blue-200 text-blue-800'
          }`}
        >
          {state.phase === 'READY'
            ? '准备就绪'
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
            {state.currentDimension !== null ? dimensionLabel(state.currentDimension) : ''}
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
                {verdictLabel(sub.verdict)}
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

      {/* 准备阶段占位 */}
      {state.phase === 'READY' && state.currentQuestionIndex === null && (
        <p className="text-xs text-neutral-400">准备就绪，即将并行开始…</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 题目看板：战斗中展示题目难度与具体数值，点击弹出选项卡查看详情
// ---------------------------------------------------------------------------

interface QuestionStatus {
  started: boolean;
  activeCount: number;
  passedBy: string | null;
}

/** 按回放进度（已播放事件，时间序）统计每道题的队内协作状态。 */
function collectQuestionStatuses(
  timedEvents: readonly TimedReplayEvent[],
  cursor: number,
): Map<number, QuestionStatus> {
  const statuses = new Map<number, QuestionStatus>();
  const ensure = (questionIndex: number): QuestionStatus => {
    const status = statuses.get(questionIndex) ?? {
      started: false,
      activeCount: 0,
      passedBy: null,
    };
    statuses.set(questionIndex, status);
    return status;
  };

  for (let index = 0; index < Math.min(cursor, timedEvents.length); index += 1) {
    const event = timedEvents[index]!.event;
    if (event.type === 'QUESTION_START') {
      const status = ensure(event.questionIndex);
      status.started = true;
      status.activeCount += 1;
    } else if (event.type === 'QUESTION_RESULT') {
      const status = ensure(event.questionIndex);
      status.activeCount = Math.max(0, status.activeCount - 1);
      if (event.verdict === 'AC' && status.passedBy === null) {
        status.passedBy = event.participantName;
      }
    }
  }
  return statuses;
}

function QuestionStatusChip({ status }: { status: QuestionStatus | undefined }): JSX.Element {
  if (!status || !status.started) {
    return <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">未开始</span>;
  }
  if (status.passedBy !== null) {
    return (
      <span
        data-testid="question-status-passed"
        className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
      >
        ✓ 已通过 · {status.passedBy}
      </span>
    );
  }
  if (status.activeCount > 0) {
    return (
      <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
        进行中 ×{status.activeCount}
      </span>
    );
  }
  return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">未通过</span>;
}

function formatHookValue(key: string, value: string | number | boolean): string {
  if (key === 'condition') return HOOK_CONDITION_LABEL[String(value)] ?? String(value);
  if (key === 'partial_override') {
    const override = String(value);
    if (override === 'none') return '无部分分';
    if (override === 'trap') return '部分分陷阱';
    return '保留部分分';
  }
  return String(value);
}

function QuestionDetailModal({
  question,
  status,
  onClose,
}: {
  question: QuestionSnapshot;
  status: QuestionStatus | undefined;
  onClose: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<'数值' | '特性'>('数值');
  const tier = question.tier !== undefined ? tierLabel(question.tier) : undefined;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`第 ${question.index + 1} 题详情`}
      onClick={(event) => {
        // 仅遮罩本身可以关闭弹窗；详情、选项卡和滚动内容的点击都必须保留在弹窗内。
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-testid="replay-question-modal"
        className="w-full max-w-lg overflow-hidden rounded border border-neutral-300 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">Problem Detail</p>
            <h3 className="mt-0.5 text-lg font-semibold">第 {question.index + 1} 题</h3>
            <p className="mt-0.5 text-xs text-neutral-500">{question.instanceId}</p>
          </div>
          <div className="flex items-center gap-2">
            <QuestionStatusChip status={status} />
            <button
              type="button"
              data-testid="replay-question-modal-close"
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>

        <div className="flex border-b border-neutral-200">
          {(['数值', '特性'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              data-testid={`replay-question-tab-${entry}`}
              className={`px-5 py-2.5 text-sm font-medium ${
                tab === entry
                  ? 'border-b-2 border-neutral-900 text-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-800'
              }`}
              onClick={() => setTab(entry)}
            >
              {entry}
              {entry === '特性' && question.traits.length > 0 ? `（${question.traits.length}）` : ''}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          {tab === '数值' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label="难度档位" value={tier ?? '—'} />
              <Metric label="主考方向" value={dimensionLabel(question.dimension)} />
              <Metric label="六维需求 D" value={String(question.demand)} />
              <Metric label="思维量 M" value={String(question.thought)} />
              <Metric label="代码量 C" value={String(question.codeVolume)} />
              <Metric label="分值" value={`${question.score} 分`} />
              <Metric label="参考用时" value={formatMinutes(question.timeLimitMin)} />
              <Metric label="部分分" value={question.partialScores ? '可得部分分' : '无部分分'} />
              <Metric label="来源" value={question.source === 'PREMADE' ? '预制题' : '临场生成'} />
              {question.quality !== undefined ? (
                <Metric label="题目质量" value={String(question.quality)} />
              ) : null}
            </div>
          ) : question.traits.length === 0 ? (
            <p className="text-sm text-neutral-500">本题没有附着特性。</p>
          ) : (
            <div className="space-y-3">
              {question.traits.map((trait, traitIndex) => (
                <div key={`${trait.traitId}-${traitIndex}`} className="rounded border border-neutral-200 p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_CLASS[trait.severity] ?? 'bg-neutral-100 text-neutral-700'}`}
                    >
                      {SEVERITY_LABEL[trait.severity] ?? trait.severity}
                    </span>
                    <span className="text-sm font-medium">{trait.traitId}</span>
                  </div>
                  {trait.hooks.length > 0 && (
                    <dl className="mt-2 space-y-1">
                      {trait.hooks.map((hook, hookIndex) =>
                        Object.entries(hook).map(([key, value]) => (
                          <div
                            key={`${hookIndex}-${key}`}
                            className="flex items-center justify-between text-xs"
                          >
                            <dt className="text-neutral-500">{HOOK_LABEL[key] ?? key}</dt>
                            <dd className="font-medium">{formatHookValue(key, value)}</dd>
                          </div>
                        )),
                      )}
                    </dl>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionBoard({
  questions,
  statuses,
}: {
  questions: readonly QuestionSnapshot[];
  statuses: Map<number, QuestionStatus>;
}): JSX.Element {
  const [openInstanceId, setOpenInstanceId] = useState<string | null>(null);
  const closeQuestion = useCallback(() => setOpenInstanceId(null), []);
  const openQuestion = questions.find((question) => question.instanceId === openInstanceId);

  return (
    <div data-testid="replay-question-board" className="mb-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-700">
          题目看板
          <span className="ml-2 text-xs font-normal text-neutral-500">
            状态随回放进度更新
          </span>
        </h3>
        <span className="text-xs text-neutral-400">点击题目查看具体数值</span>
      </div>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(questions.length, 4))}, minmax(0, 1fr))` }}
      >
        {questions.map((question) => {
          const status = statuses.get(question.index);
          const tier = question.tier !== undefined ? tierLabel(question.tier) : undefined;
          return (
            <button
              key={question.instanceId}
              type="button"
              data-testid={`replay-question-card-${question.index}`}
              className={`rounded border p-3 text-left transition-colors hover:border-neutral-400 ${
                status?.passedBy
                  ? 'border-green-300 bg-green-50'
                  : status && status.activeCount > 0
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-neutral-200 bg-white'
              }`}
              onClick={() => setOpenInstanceId(question.instanceId)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">第 {question.index + 1} 题</span>
                {tier !== undefined && (
                  <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {tier}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-neutral-600">
                {dimensionLabel(question.dimension)} · {question.score} 分 ·
                参考 {Math.ceil(question.timeLimitMin)} 分钟
              </p>
              <p className="mt-1 font-mono text-[11px] text-neutral-500">
                D {question.demand} / M {question.thought} / C {question.codeVolume}
                {question.traits.length > 0 ? ` · 特性×${question.traits.length}` : ''}
              </p>
              <div className="mt-2">
                <QuestionStatusChip status={status} />
              </div>
            </button>
          );
        })}
      </div>
      {openQuestion !== undefined && (
        <QuestionDetailModal
          question={openQuestion}
          status={statuses.get(openQuestion.index)}
          onClose={closeQuestion}
        />
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
              {dimensionLabel(event.dimension)} · {event.problemInstanceId} ·{' '}
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
            <Metric label="判定" value={verdictLabel(event.verdict)} />
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
              {verdictLabel(event.verdict)}
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
            {event.setterName} 出题 → {contestSideLabel(event.answererSide)}答题
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
              {event.solved ? '答题成功' : (roundReasonLabel(event.reason))}
            </span>
            <span className="text-sm text-neutral-500">
              {event.setterName} 出题 → {event.answererName} 答题
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="本局得分"
              value={`${contestSideLabel(event.scoreAwardedTo)} +${event.scoreAwarded}`}
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
