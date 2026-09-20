import type { JSX } from 'react';
import type { StudentView } from '@oinur/shared';
import { Check } from 'lucide-react';
import { QUALITY_LABEL, floor } from '../lib/labels';
import { QUALITY_MATERIAL } from '../lib/rarity';
import { Icon } from './icons';

/**
 * 出战阵容选择器（剧情 / 历练 / PVP 共用）。
 * 保留原生 `input[type=checkbox]`：勾选、取消与满员禁用都走真实控件状态。
 * DOM 契约：`{prefix}-checkbox-{id}`（原生 checkbox）、`{prefix}-count`、`{prefix}-student-{id}`。
 */
export function RosterPicker({
  students,
  selectedIds,
  min,
  max,
  onChange,
  dataTestIdPrefix,
}: {
  students: StudentView[];
  selectedIds: number[];
  min: number;
  max: number;
  onChange: (ids: number[]) => void;
  dataTestIdPrefix: string;
}): JSX.Element {
  const selected = new Set(selectedIds);
  const atMax = selected.size >= max;

  const toggle = (studentId: number, checked: boolean) => {
    if (checked) {
      if (selected.has(studentId) || selected.size >= max) return;
      onChange([...selectedIds, studentId]);
      return;
    }
    onChange(selectedIds.filter((id) => id !== studentId));
  };

  return (
    <fieldset className="space-y-3">
      <legend className="flex w-full items-baseline justify-between gap-3">
        <span className="eyebrow">出战阵容</span>
        <span data-testid={`${dataTestIdPrefix}-count`} className="text-xs text-fg-dim">
          已选 <span className="font-mono text-fg">{selected.size}</span>/{max}
          {min === max ? '' : `（至少 ${min} 名）`}
        </span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {students.map((student) => {
          const checked = selected.has(student.id);
          const disabled = !checked && atMax;
          return (
            <label
              key={student.id}
              data-testid={`${dataTestIdPrefix}-student-${student.id}`}
              className={`flex items-start gap-2.5 border px-3 py-2.5 transition-colors ${
                checked
                  ? 'border-cyber-400/70 bg-cyber-400/[0.08]'
                  : `${QUALITY_MATERIAL[student.qualityTier]} hover:border-ink-500`
              } ${disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}
            >
              <input
                data-testid={`${dataTestIdPrefix}-checkbox-${student.id}`}
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => toggle(student.id, event.target.checked)}
                className="mt-1 size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-fg">{student.name}</span>
                  <span className="shrink-0 text-[10px] text-fg-faint">
                    {QUALITY_LABEL[student.qualityTier]}
                  </span>
                  {checked && <Icon icon={Check} className="ml-auto size-3.5 shrink-0 text-cyber-300" />}
                </span>
                <span className="mt-1 block font-mono text-[11px] text-fg-dim">
                  V {floor(student.v)} · 精力 {floor(student.energy)}/{floor(student.energyMax)} · 体力{' '}
                  {floor(student.stamina)}/5
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {atMax && <p className="text-[11px] text-fg-faint">已选满 {max} 人，取消勾选后可更换人选。</p>}
    </fieldset>
  );
}
