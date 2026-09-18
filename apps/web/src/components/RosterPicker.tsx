import type { StudentView } from '@oinur/shared';
import type { JSX } from 'react';

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
      <legend className="flex w-full items-baseline justify-between gap-3 text-sm">
        <span className="text-neutral-500">出战学员</span>
        <span data-testid={`${dataTestIdPrefix}-count`} className="text-xs text-neutral-500">
          已选 {selected.size}/{max}
          {min === max ? '' : `（至少 ${min} 名）`}
        </span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {students.map((student) => {
          const checked = selected.has(student.id);
          return (
            <label
              key={student.id}
              data-testid={`${dataTestIdPrefix}-student-${student.id}`}
              className={`flex cursor-pointer items-start gap-3 rounded border px-3 py-3 text-sm transition-colors ${
                checked
                  ? 'border-neutral-900 bg-neutral-50'
                  : 'border-neutral-200 bg-white hover:border-neutral-400'
              }`}
            >
              <input
                data-testid={`${dataTestIdPrefix}-checkbox-${student.id}`}
                type="checkbox"
                checked={checked}
                disabled={!checked && atMax}
                onChange={(event) => toggle(student.id, event.target.checked)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block truncate font-medium">{student.name}</span>
                <span className="mt-1 block text-xs text-neutral-500">
                  V {student.v} · 精力 {Math.floor(student.energy)}/{Math.floor(student.energyMax)} ·
                  {' '}体力 {Math.floor(student.stamina)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
