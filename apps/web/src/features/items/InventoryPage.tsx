import { useState, type JSX } from 'react';
import type { StudentView } from '@oinur/shared';
import { ApiCallError } from '../../lib/api';
import {
  CATEGORY_LABEL,
  rarityBadge,
  rarityText,
  useInventory,
  useStudents,
  useUseItem,
} from '../../lib/hooks';
import type { ItemView } from '../../lib/hooks';
import { Link } from 'react-router';

const CATEGORY_ORDER = ['nurture', 'book', 'functional', 'contest', 'quest', 'material'];

/** M1 可经 /api/items/use 直接使用的道具（与后端 effects.ts 一致） */
const DIRECT_USE: ReadonlySet<string> = new Set([
  'calm-pill',
  'milk-tea',
  'stamina-potion',
  'coffee',
  'focus-engine',
]);

/** 直用书：book-{thinking|coding|setting}-*（背包即用，固定增益） */
function isDirectUseBook(itemId: string): boolean {
  const m = /^book-(.+)-\w+$/.exec(itemId);
  return m ? ['thinking', 'coding', 'setting'].includes(m[1]) : false;
}

function isUsable(item: ItemView): boolean {
  return DIRECT_USE.has(item.itemId) || isDirectUseBook(item.itemId);
}

export function InventoryPage(): JSX.Element {
  const inv = useInventory();
  const students = useStudents();
  const [picker, setPicker] = useState<ItemView | null>(null);

  if (inv.isLoading) return <p className="text-neutral-500">加载中…</p>;
  if (inv.isError || !inv.data) return <p className="text-red-600">加载失败</p>;
  const items = inv.data;

  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: items.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">背包</h1>
      {items.length === 0 ? (
        <p className="text-neutral-500">背包空空如也。</p>
      ) : groups.length === 0 ? (
        <p className="text-neutral-500">暂无道具。</p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.cat}>
              <h2 className="mb-2 text-sm font-semibold text-neutral-500">
                {CATEGORY_LABEL[g.cat] ?? g.cat}
              </h2>
              <ul className="space-y-2">
                {g.items.map((item) => (
                  <InventoryRow key={item.itemId} item={item} onUse={() => setPicker(item)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {picker && (
        <StudentPicker
          item={picker}
          students={students.data ?? []}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function InventoryRow({ item, onUse }: { item: ItemView; onUse: () => void }): JSX.Element {
  const usable = isUsable(item);
  const isRenameCard = item.itemId === 'rename-card';
  const needsStudent = !isRenameCard;
  return (
    <li className="rounded border bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{item.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${rarityBadge(item.rarity)}`}>
              {rarityText(item.rarity)}
            </span>
            <span className="text-xs text-neutral-400">×{item.quantity}</span>
          </div>
          {item.effectDesc && <p className="mt-1 text-xs text-neutral-500">{item.effectDesc}</p>}
          <p className="mt-0.5 text-xs text-neutral-400">{item.description}</p>
        </div>
        <div className="shrink-0 text-right text-sm">
          {usable ? (
            <button
              className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white"
              onClick={onUse}
              title={needsStudent ? '需选择一名学员' : '使用'}
            >
              使用
            </button>
          ) : isRenameCard ? (
            <Link
              to="/students"
              className="inline-block rounded bg-neutral-200 px-3 py-1.5 text-xs text-neutral-600"
            >
              去学员页改名
            </Link>
          ) : (
            <span className="rounded bg-neutral-200 px-3 py-1.5 text-xs text-neutral-500">
              暂不可用
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function StudentPicker({
  item,
  students,
  onClose,
}: {
  item: ItemView;
  students: StudentView[];
  onClose: () => void;
}): JSX.Element {
  const use = useUseItem();
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(students[0]?.id ?? null);

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded border bg-white p-5">
        <h3 className="mb-2 font-semibold">为「{item.name}」选择一名学员</h3>
        {students.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无可选学员，请先招募学员。</p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {students.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-100"
              >
                <input
                  type="radio"
                  name="student"
                  className="accent-neutral-900"
                  checked={selected === s.id}
                  onChange={() => setSelected(s.id)}
                />
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-neutral-400">V {s.v}</span>
              </label>
            ))}
          </div>
        )}
        {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>
            取消
          </button>
          <button
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
            disabled={students.length === 0 || selected == null || use.isPending}
            onClick={() =>
              selected != null &&
              use.mutate(
                { itemId: item.itemId, studentId: selected },
                {
                  onSuccess: () => {
                    setMsg(null);
                    onClose();
                  },
                  onError: (e) => setMsg(e instanceof ApiCallError ? '使用失败' : '使用失败'),
                },
              )
            }
          >
            确定使用
          </button>
        </div>
      </div>
    </div>
  );
}
