import type { JSX } from 'react';
import { CircleCheck, Swords } from 'lucide-react';
import { ApiCallError } from '../../lib/api';
import { Btn } from '../../components/ui';
import { Icon } from '../../components/icons';
import { RosterPicker } from '../../components/RosterPicker';
import { traitName } from '../../lib/labels';
import { rarityChip } from '../../lib/rarity';
import type { PvpRegistrationView } from '../../lib/hooks';
import type { ProblemView } from '../../lib/hooks';
import type { StudentView } from '@oinur/shared';

/** 报名表单：原生 select/checkbox 之外的阵容勾选复用 RosterPicker（testid 前缀 pvp-roster） */
export function RegistrationForm({
  students,
  problems,
  rosterSize,
  tickets,
  roster,
  onRosterChange,
  problemIds,
  onProblemsChange,
  onSubmit,
  pending,
  error,
}: {
  students: StudentView[];
  problems: ProblemView[];
  rosterSize: number;
  tickets: number;
  roster: number[];
  onRosterChange: (ids: number[]) => void;
  problemIds: number[];
  onProblemsChange: (ids: number[]) => void;
  onSubmit: () => void;
  pending: boolean;
  error: unknown;
}): JSX.Element {
  const ready = roster.length === rosterSize;
  const shortfall = rosterSize - roster.length;

  return (
    <div className="space-y-4">
      <RosterPicker
        students={students}
        selectedIds={roster}
        min={rosterSize}
        max={rosterSize}
        onChange={onRosterChange}
        dataTestIdPrefix="pvp-roster"
      />

      <fieldset className="border border-ink-600/70 bg-ink-850/40 px-3 py-3">
        <legend className="px-1 text-xs text-fg-dim">
          携带预制题（最多 2 道，出题质量 40 以上）
        </legend>
        {problems.length === 0 ? (
          <p className="text-xs text-fg-faint">
            题库里还没有够格上场的题目，去出题题库多写几道吧。
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {problems.map((problem) => {
              const checked = problemIds.includes(problem.id);
              return (
                <label
                  key={problem.id}
                  className={`flex cursor-pointer items-center gap-2 border px-2.5 py-2 text-xs transition-colors ${
                    checked ? 'border-cyber-500/60 bg-cyber-400/5' : 'border-ink-600/70 bg-ink-900/40'
                  }`}
                >
                  <input
                    data-testid={`pvp-problem-${problem.id}`}
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && problemIds.length >= 2}
                    onChange={(event) =>
                      onProblemsChange(
                        event.target.checked
                          ? [...problemIds, problem.id]
                          : problemIds.filter((id) => id !== problem.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{problem.name}</span>
                  <span className="tnum shrink-0 text-fg-dim">Q {problem.quality}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-dim">
          <span>报名券持有 {tickets}</span>
          {!ready && <span className="text-warn-400">还需选择 {shortfall} 名出战学员</span>}
        </div>
        <Btn
          variant="primary"
          data-testid="pvp-register"
          disabled={pending || !ready}
          onClick={onSubmit}
        >
          <Icon icon={Swords} className="size-3.5" />
          {pending ? '报名中…' : '提交报名'}
        </Btn>
      </div>

      {error !== undefined && error !== null && (
        <p data-testid="pvp-error" className="text-sm text-bad-400">
          {error instanceof ApiCallError && error.code === 'INSUFFICIENT_RESOURCE'
            ? '报名券不足。'
            : '报名失败，请检查资格与截止时间。'}
        </p>
      )}
    </div>
  );
}

/** 已报名视图：名单与携带题快照（阵容名用中文顿号连接） */
export function RegistrationView({
  registration,
}: {
  registration: PvpRegistrationView;
}): JSX.Element {
  return (
    <div className="space-y-3 border border-good-400/40 bg-good-400/5 px-4 py-3">
      <p
        data-testid="pvp-registered"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-good-400"
      >
        <Icon icon={CircleCheck} className="size-4" />
        已报名，出战名单已锁定
      </p>
      <p data-testid="pvp-roster-list" className="text-sm text-fg-muted">
        出战：{registration.roster.map((member) => member.displayName).join('、')}
      </p>
      <div className="flex flex-wrap gap-2">
        {registration.problemSnapshots.length === 0 ? (
          <span className="text-xs text-fg-faint">未携带预制题，全程使用临场生成题。</span>
        ) : (
          registration.problemSnapshots.map((problem) => (
            <span
              key={problem.id}
              className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] ${rarityChip(problem.rarity)}`}
            >
              <span className="truncate">{problem.name}</span>
              <span className="tnum opacity-80">Q {problem.quality}</span>
              {problem.traitId !== null && <span className="opacity-80">{traitName(problem.traitId)}</span>}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
