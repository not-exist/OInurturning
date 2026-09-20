import type { JSX } from 'react';
import { Timer } from 'lucide-react';
import type { BattleReplayEvent, QuestionSnapshot } from '@oinur/shared';
import { dimensionLabel, floor, signed } from '../../../lib/labels';
import { Icon } from '../../../components/icons';
import { VerdictBadge } from '../shared/bits';

export type MemberPhase = 'READY' | 'THINKING' | 'SUBMITTING' | 'DONE';

export interface MemberPanelState {
  memberIndex: number;
  displayName: string;
  currentQuestionIndex: number | null;
  currentDimension: string | null;
  currentScore: number | null;
  phase: MemberPhase;
  submissions: { attemptNo: number; verdict: string; timeMin: number; penaltyMin: number }[];
  questionVerdict: string | null;
  timeSpentMin: number | null;
  timeLimitMin: number | null;
  totalScore: number;
  energyAfter: number;
  focusAfter: number;
  mindsetAfter: number;
  notes: string[];
}

export function createEmptyMemberState(
  memberIndex: number,
  displayName: string,
): MemberPanelState {
  return {
    memberIndex,
    displayName,
    currentQuestionIndex: null,
    currentDimension: null,
    currentScore: null,
    phase: 'READY',
    submissions: [],
    questionVerdict: null,
    timeSpentMin: null,
    timeLimitMin: null,
    totalScore: 0,
    energyAfter: 0,
    focusAfter: 0,
    mindsetAfter: 0,
    notes: [],
  };
}

/** 单事件推进：按 memberIndex 原地改写该队员面板状态（并行赛每人一条独立时间线） */
export function applyMemberEvent(
  members: Map<number, MemberPanelState>,
  event: BattleReplayEvent,
  questions: Map<string, QuestionSnapshot>,
): void {
  if (
    event.type !== 'QUESTION_START' &&
    event.type !== 'SUBMISSION' &&
    event.type !== 'QUESTION_RESULT'
  ) {
    return;
  }
  const memberIndex = event.memberIndex;
  if (memberIndex === undefined) return;
  const member = members.get(memberIndex);
  if (member === undefined) return;

  switch (event.type) {
    case 'QUESTION_START':
      member.currentQuestionIndex = event.questionIndex;
      member.currentDimension = event.dimension;
      member.currentScore = event.score;
      member.phase = 'THINKING';
      member.submissions = [];
      member.questionVerdict = null;
      member.timeSpentMin = null;
      member.timeLimitMin = questions.get(event.problemInstanceId)?.timeLimitMin ?? null;
      member.notes = [];
      break;
    case 'SUBMISSION':
      member.phase = 'SUBMITTING';
      member.submissions.push({
        attemptNo: event.attemptNumber,
        verdict: event.verdict,
        timeMin: event.submissionTimeMin,
        penaltyMin: event.penaltyMin,
      });
      break;
    case 'QUESTION_RESULT':
      member.phase = 'DONE';
      member.questionVerdict = event.verdict;
      member.timeSpentMin = event.timeSpentMin;
      member.totalScore = event.totalScore;
      member.energyAfter = event.energyAfter;
      member.focusAfter = event.focusAfter;
      member.mindsetAfter = event.mindsetAfter;
      member.notes = event.notes;
      break;
  }
}

function phaseChip(state: MemberPanelState): { label: string; cls: string } {
  switch (state.phase) {
    case 'READY':
      return { label: '准备就绪', cls: 'border-ink-600 text-fg-dim' };
    case 'THINKING':
      return { label: '思考中', cls: 'border-cyber-500/60 text-cyber-300' };
    case 'SUBMITTING':
      return { label: '编码中', cls: 'border-arc-400/60 text-arc-300' };
    case 'DONE':
      return state.questionVerdict === 'AC'
        ? { label: '本题通过', cls: 'border-good-400/60 text-good-400' }
        : { label: '本题结束', cls: 'border-bad-400/50 text-bad-400' };
  }
}

/** 压哨：AC 且用时顶到时限，转播的高潮点 */
function isBuzzer(state: MemberPanelState): boolean {
  return (
    state.questionVerdict === 'AC' &&
    state.timeSpentMin !== null &&
    state.timeLimitMin !== null &&
    state.timeSpentMin >= state.timeLimitMin
  );
}

/** 并行转播中的单个队员面板：AC 是亮色爽点，WA 罚时是高亮痛点 */
export function MemberPanel({ state }: { state: MemberPanelState }): JSX.Element {
  const phase = phaseChip(state);
  const frame =
    state.phase === 'DONE'
      ? state.questionVerdict === 'AC'
        ? 'border-good-400/60 bg-good-400/5'
        : 'border-bad-400/50 bg-bad-400/5'
      : state.phase === 'READY'
        ? 'border-ink-600/70 bg-ink-850/40'
        : 'border-cyber-500/60 bg-cyber-400/5';

  return (
    <div
      data-testid="replay-member-panel"
      className={`border px-3 py-3 transition-colors duration-300 ${frame}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{state.displayName}</span>
        <span className={`shrink-0 border px-1.5 py-0.5 text-[10px] ${phase.cls}`}>
          {phase.label}
        </span>
      </div>

      {state.currentQuestionIndex !== null ? (
        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="numeral text-2xl text-fg">{state.currentQuestionIndex + 1}</span>
          <span className="text-[11px] text-fg-dim">题</span>
          <span className="ml-auto text-[11px] text-fg-muted">
            {state.currentDimension === null ? '' : dimensionLabel(state.currentDimension)}
            {state.currentScore === null ? '' : ` · ${state.currentScore} 分`}
          </span>
        </div>
      ) : (
        <p className="mt-2.5 text-[11px] text-fg-faint">待命，等待并行开题…</p>
      )}

      {state.submissions.length > 0 && (
        <ul className="mt-2 space-y-1">
          {state.submissions.map((submission) => (
            <li key={submission.attemptNo} className="flex items-center gap-2 text-[11px]">
              <span className="tnum text-fg-faint">#{submission.attemptNo}</span>
              <VerdictBadge verdict={submission.verdict} />
              {submission.penaltyMin > 0 && (
                <span className="ml-auto text-warn-400">
                  罚时 +{Math.ceil(submission.penaltyMin)} 分
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {state.phase === 'DONE' && (
        <div className="mt-2.5 border-t border-ink-600/60 pt-2">
          {isBuzzer(state) && (
            <p className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-warn-400">
              <Icon icon={Timer} className="size-3" />
              压哨通过
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <div className="flex items-baseline justify-between">
              <dt className="text-fg-dim">本题得分</dt>
              <dd className="tnum font-semibold text-fg">{state.totalScore}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-fg-dim">剩余精力</dt>
              <dd className="tnum text-fg-muted">{floor(state.energyAfter)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-fg-dim">当前专注</dt>
              <dd className="tnum text-fg-muted">{floor(state.focusAfter)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-fg-dim">心态</dt>
              <dd className={`tnum ${state.mindsetAfter < 0 ? 'text-bad-400' : 'text-fg-muted'}`}>
                {signed(state.mindsetAfter)}
              </dd>
            </div>
          </dl>
          {state.notes.length > 0 && (
            <p className="mt-1.5 text-[11px] text-fg-dim">{state.notes.join('、')}</p>
          )}
        </div>
      )}
    </div>
  );
}
