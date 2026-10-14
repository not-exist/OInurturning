import { useState, type JSX } from 'react';
import type { BattleReplayEvent, FrozenSolveHooks, QuestionSnapshot } from '@oinur/shared';
import { Metric } from '../shared/bits';
import { Modal } from '../../../components/ui';
import { dimensionLabel, tierLabel, traitInfo } from '../../../lib/labels';
import {
  SEVERITY_CLS,
  SEVERITY_LABEL,
  SEVERITY_NUMERAL,
  TIER_TEXT,
  isSeverity,
  isTier,
} from '../../../lib/rarity';

export interface QuestionStatus {
  started: boolean;
  activeCount: number;
  passedBy: string | null;
}

/** 单事件推进：每题的队内协作状态（谁在做、谁已过） */
export function applyEventToQuestionStatus(
  statuses: Map<number, QuestionStatus>,
  event: BattleReplayEvent,
): void {
  if (event.type !== 'QUESTION_START' && event.type !== 'QUESTION_RESULT') return;
  const status = statuses.get(event.questionIndex) ?? {
    started: false,
    activeCount: 0,
    passedBy: null,
  };
  statuses.set(event.questionIndex, status);

  if (event.type === 'QUESTION_START') {
    status.started = true;
    status.activeCount += 1;
    return;
  }
  status.activeCount = Math.max(0, status.activeCount - 1);
  if (event.verdict === 'AC' && status.passedBy === null) {
    status.passedBy = event.participantName;
  }
}

function QuestionStatusChip({ status }: { status: QuestionStatus | undefined }): JSX.Element {
  if (status === undefined || !status.started) {
    return <span className="border border-ink-600 px-1.5 py-0.5 text-[10px] text-fg-faint">未开题</span>;
  }
  if (status.passedBy !== null) {
    return (
      <span className="border border-good-400/60 bg-good-400/10 px-1.5 py-0.5 text-[10px] text-good-400">
        已通过 · {status.passedBy}
      </span>
    );
  }
  if (status.activeCount > 0) {
    return (
      <span className="border border-cyber-500/60 bg-cyber-400/10 px-1.5 py-0.5 text-[10px] text-cyber-300">
        进行中 ×{status.activeCount}
      </span>
    );
  }
  return <span className="border border-ink-600 px-1.5 py-0.5 text-[10px] text-fg-dim">暂时卡住</span>;
}

/** 特性严重度刻度（罗马数字 Ⅰ–Ⅵ + 名称；red 是最轻且最高频的一档，不做灾难告警） */
function TraitChip({ traitId, severity }: { traitId: string; severity: string }): JSX.Element {
  const severityTone = isSeverity(severity) ? SEVERITY_CLS[severity] : SEVERITY_CLS.blue;
  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] ${severityTone}`}
    >
      <span className="font-mono">{isSeverity(severity) ? SEVERITY_NUMERAL[severity] : '·'}</span>
      {traitInfo(traitId)?.name ?? '未知特性'}
    </span>
  );
}

const HOOK_LABEL = {
  condition: '触发条件',
  time_k_mul: '耗时乘数',
  ac_prob_add: '通过概率加成',
  tle_prob_add: '超时概率加成',
  wa_penalty_add: '错误罚时加成',
  submit_time_add: '提交用时加成',
  energy_cost_add: '精力消耗加成',
  energy_per_submit_add: '每次提交精力',
  noise_sigma_add: '用时噪声 σ 加成',
  noise_sigma_mul: '用时噪声 σ 乘数',
  mindset_fail_add: '失败心态惩罚',
  partial_override: '部分分规则',
  think_weight_mul: '思维缺口权重',
  prob_amplify: '概率放大',
} satisfies Record<keyof FrozenSolveHooks, string>;

function hookValueText(key: string, value: string | number | boolean): string {
  if (key === 'condition') return value === 'first_problem' ? '队伍第一题' : '防 AK（仅剩一题未过）';
  if (key === 'partial_override') {
    if (value === 'none') return '无部分分';
    if (value === 'trap') return '部分分陷阱';
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
  const tier = question.tier !== undefined && isTier(question.tier) ? question.tier : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      testId="replay-question-modal"
      eyebrow="Problem Detail"
      title={`第 ${question.index + 1} 题`}
      headerExtra={<QuestionStatusChip status={status} />}
    >
      <div role="tablist" className="mb-4 flex border-b border-ink-600/70">
        {(['数值', '特性'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            data-testid={`replay-question-tab-${entry}`}
            onClick={() => setTab(entry)}
            className={`px-4 py-2 text-sm transition-colors ${
              tab === entry
                ? 'border-b-2 border-cyber-400 font-semibold text-cyber-300'
                : 'text-fg-dim hover:text-fg'
            }`}
          >
            {entry}
            {entry === '特性' && question.traits.length > 0 ? `（${question.traits.length}）` : ''}
          </button>
        ))}
      </div>

      {tab === '数值' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Metric
            label="难度档位"
            value={tier === undefined ? '临场生成' : tierLabel(tier)}
            tone={tier === undefined ? 'text-fg-muted' : TIER_TEXT[tier]}
          />
          <Metric label="主考方向" value={dimensionLabel(question.dimension)} />
          <Metric label="需求 D" value={question.demand} />
          <Metric label="思维量 M" value={question.thought} />
          <Metric label="代码量 C" value={question.codeVolume} />
          <Metric label="分值" value={`${question.score} 分`} />
          <Metric label="参考用时" value={`${Math.ceil(question.timeLimitMin)} 分钟`} />
          <Metric
            label="部分分"
            value={question.partialScores ? '可得部分分' : '全有或全无'}
            tone={question.partialScores ? 'text-fg' : 'text-warn-400'}
          />
          <Metric
            label="来源"
            value={question.source === 'PREMADE' ? '题库预制' : '临场生成'}
          />
          {question.quality !== undefined && (
            <Metric label="题目质量" value={question.quality} />
          )}
        </div>
      ) : question.traits.length === 0 ? (
        <p className="text-sm text-fg-dim">本题没有附着特性。</p>
      ) : (
        <div className="space-y-2.5">
          {question.traits.map((trait, traitIndex) => {
            const info = traitInfo(trait.traitId);
            const severityTone = isSeverity(trait.severity)
              ? SEVERITY_CLS[trait.severity]
              : SEVERITY_CLS.blue;
            return (
              <div
                key={`${trait.traitId}-${traitIndex}`}
                className="border border-ink-600/70 bg-ink-850/40 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex size-5 shrink-0 items-center justify-center border font-mono text-[11px] ${severityTone}`}
                  >
                    {isSeverity(trait.severity) ? SEVERITY_NUMERAL[trait.severity] : '·'}
                  </span>
                  <span className="text-sm font-medium">{info?.name ?? '未知特性'}</span>
                  <span className="ml-auto text-[11px] text-fg-dim">
                    {isSeverity(trait.severity) ? SEVERITY_LABEL[trait.severity] : '未知刻度'}
                  </span>
                </div>
                {info !== null && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-fg-muted">{info.effect}</p>
                )}
                {trait.hooks.map((hook, hookIndex) => (
                  <dl
                    key={hookIndex}
                    className="mt-2 grid gap-x-4 gap-y-1 border-t border-ink-600/50 pt-2 sm:grid-cols-2"
                  >
                    {Object.entries(hook as FrozenSolveHooks).map(([key, value]) => (
                      <div key={key} className="flex items-baseline justify-between gap-2 text-[11px]">
                        <dt className="text-fg-dim">
                          {(HOOK_LABEL as Record<string, string>)[key] ?? '附加效果'}
                        </dt>
                        <dd className="tnum text-fg-muted">{hookValueText(key, value)}</dd>
                      </div>
                    ))}
                  </dl>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function QuestionCard({
  question,
  status,
  onOpen,
}: {
  question: QuestionSnapshot;
  status: QuestionStatus | undefined;
  onOpen: () => void;
}): JSX.Element {
  const tier = question.tier !== undefined && isTier(question.tier) ? question.tier : undefined;
  const passed = status !== undefined && status.passedBy !== null;
  const frame = passed
    ? 'border-good-400/50 bg-good-400/5 hover:border-good-400/80'
    : status !== undefined && status.activeCount > 0
      ? 'border-cyber-500/60 bg-cyber-400/5 hover:border-cyber-400'
      : 'border-ink-600/70 bg-ink-850/40 hover:border-ink-500';

  return (
    <button
      type="button"
      data-testid={`replay-question-card-${question.index}`}
      onClick={onOpen}
      className={`border px-3 py-2.5 text-left transition-colors ${frame}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">第 {question.index + 1} 题</span>
        {tier !== undefined && (
          <span className={`font-mono text-[10px] tracking-wider ${TIER_TEXT[tier]}`}>
            {tierLabel(tier)}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-fg-muted">
        {dimensionLabel(question.dimension)} · {question.score} 分 · 参考{' '}
        {Math.ceil(question.timeLimitMin)} 分钟
      </p>
      <p className="tnum mt-0.5 font-mono text-[10px] text-fg-faint">
        D {question.demand} / M {question.thought} / C {question.codeVolume}
      </p>
      {question.traits.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {question.traits.map((trait, index) => (
            <TraitChip key={`${trait.traitId}-${index}`} traitId={trait.traitId} severity={trait.severity} />
          ))}
        </div>
      )}
      <div className="mt-2">
        <QuestionStatusChip status={status} />
      </div>
    </button>
  );
}

/** 题目看板：回放中的队伍题目墙，点开看数值与特性（弹窗内点击不视为关闭遮罩） */
export function QuestionBoard({
  questions,
  statuses,
}: {
  questions: readonly QuestionSnapshot[];
  statuses: Map<number, QuestionStatus>;
}): JSX.Element {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const openQuestion = questions.find((question) => question.index === openIndex);

  return (
    <div data-testid="replay-question-board" className="mb-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-fg-muted">题目看板</h3>
        <span className="text-[11px] text-fg-faint">点击题目查看数值与特性</span>
      </div>
      <div
        className="grid gap-2.5"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, Math.min(questions.length, 4))}, minmax(0, 1fr))`,
        }}
      >
        {questions.map((question) => (
          <QuestionCard
            key={question.instanceId}
            question={question}
            status={statuses.get(question.index)}
            onOpen={() => setOpenIndex(question.index)}
          />
        ))}
      </div>
      {openQuestion !== undefined && (
        <QuestionDetailModal
          question={openQuestion}
          status={statuses.get(openQuestion.index)}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}
