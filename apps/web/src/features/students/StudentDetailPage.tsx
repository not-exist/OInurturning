import { useState, type JSX } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { DimensionKey, StudentView } from '@oinur/shared';
import { ApiCallError } from '../../lib/api';
import {
  DIMENSION_LABEL,
  QUALITY_LABEL,
  SEX_LABEL,
  floor,
  rarityBadge,
  rarityText,
  round,
  useDismissStudent,
  useInventory,
  useRenameStudent,
  useStudent,
  useTalentDefs,
} from '../../lib/hooks';

const DIMS: Record<DimensionKey, keyof StudentView> = {
  DS: 'ds',
  DP: 'dp',
  MATH: 'math',
  GRAPH: 'graph',
  GREEDY: 'greedy',
  STRING: 'str',
};

function NineDimRow({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b py-1.5 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="tabular-nums">{floor(value)}</span>
    </div>
  );
}

export function StudentDetailPage(): JSX.Element {
  const { id } = useParams();
  const sid = Number(id);
  const nav = useNavigate();
  const q = useStudent(Number.isInteger(sid) ? sid : undefined);
  const talentsQ = useTalentDefs();
  const invQ = useInventory();
  const dismiss = useDismissStudent();
  const [renameOpen, setRenameOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (q.isLoading) return <p className="text-neutral-500">加载中…</p>;
  if (q.isError || !q.data) return <p className="text-red-600">加载失败</p>;
  const s = q.data;

  const renameCards = invQ.data?.find((i) => i.itemId === 'rename-card')?.quantity ?? 0;
  const talentDefs = talentsQ.data ?? [];
  const defById = new Map(talentDefs.map((t) => [t.id, t]));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/students" className="text-sm text-neutral-500 hover:underline">
          ← 返回学员列表
        </Link>
        <button
          onClick={() => setDismissOpen(true)}
          className="rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-60"
          disabled={dismiss.isPending}
        >
          开除学员
        </button>
      </div>

      <section className="rounded border bg-white p-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-lg font-bold">{s.name}</h2>
          <span className={`rounded px-2 py-0.5 text-xs ${rarityBadge(qualityToRarity(s.qualityTier))}`}>
            {QUALITY_LABEL[s.qualityTier]}
          </span>
          <span className="text-xs text-neutral-400">{SEX_LABEL[s.sex]}</span>
        </div>
        <p className="mb-2 text-xs text-neutral-500">
          V = {s.v} · 心态 {round(s.mindset)} · 体力 {floor(s.stamina)}/{5} · 精力 {floor(s.energy)}/
          {s.energyMax} · 专注上限 {s.focusCap} · 体力恢复 {floor(s.staminaRegen)}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setRenameOpen((v) => !v)}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
            disabled={renameCards < 1}
            title={renameCards < 1 ? '需要改名卡（背包获取）' : '消耗 1 张改名卡'}
          >
            改名（拥有 {renameCards} 张改名卡）
          </button>
        </div>
        {renameOpen && renameCards >= 1 && <RenameForm s={s} onDone={() => setRenameOpen(false)} />}

        {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
      </section>

      <section className="rounded border bg-white p-4">
        <h3 className="mb-2 font-semibold">九维能力</h3>
        <NineDimRow label="代码" value={s.code} />
        <NineDimRow label="思维" value={s.thinking} />
        <NineDimRow label="出题" value={s.setting} />
        <div className="mt-2 grid grid-cols-2 gap-x-6">
          {(Object.keys(DIMS) as DimensionKey[]).map((d) => (
            <NineDimRow key={d} label={DIMENSION_LABEL[d]} value={s[DIMS[d]] as number} />
          ))}
        </div>
      </section>

      <section className="rounded border bg-white p-4">
        <h3 className="mb-2 font-semibold">天赋</h3>
        {s.talents.length === 0 ? (
          <p className="text-sm text-neutral-500">无天赋</p>
        ) : (
          <ul className="space-y-2">
            {s.talents.map((tid) => {
              const def = defById.get(tid);
              return (
                <li key={tid} className="rounded border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{def?.name ?? tid}</span>
                    <span className={`rounded px-2 py-0.5 text-xs ${rarityBadge(def?.rarity ?? 'GRAY')}`}>
                      {rarityText(def?.rarity ?? 'GRAY')}
                    </span>
                  </div>
                  {def ? (
                    <>
                      <p className="mt-1 text-xs text-neutral-500">{def.description}</p>
                      <p className="mt-1 text-xs text-neutral-400">
                        {def.effects.map((e) => `${e.stat} ${e.mode} ${e.value}`).join(' · ')}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-neutral-400">（天赋详情接口待后端补充）</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {talentsQ.isError && (
          <p className="text-xs text-neutral-400">天赋详情暂不可用（后端未提供 GET /api/talents）</p>
        )}
      </section>

      {dismissOpen && (
        <DismissDialog
          s={s}
          onCancel={() => setDismissOpen(false)}
          onConfirm={() => {
            dismiss.mutate(s.id, {
              onError: (e) => setMsg(e instanceof ApiCallError ? '开除失败' : '开除失败'),
              onSuccess: () => {
                setDismissOpen(false);
                nav('/students');
              },
            });
          }}
        />
      )}
    </div>
  );
}

function qualityToRarity(t: StudentView['qualityTier']): 'GRAY' | 'YELLOW' | 'GREEN' | 'BLUE' | 'PURPLE' {
  switch (t) {
    case 'COMMON':
      return 'GRAY';
    case 'GOOD':
      return 'GREEN';
    case 'ELITE':
      return 'BLUE';
    case 'GENIUS':
      return 'PURPLE';
    default:
      return 'GRAY';
  }
}

function RenameForm({ s, onDone }: { s: StudentView; onDone: () => void }): JSX.Element {
  const rename = useRenameStudent();
  const [name, setName] = useState(s.name);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="mt-2 flex gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        rename.mutate(
          { id: s.id, name },
          {
            onSuccess: () => {
              onDone();
            },
            onError: (err) => setMsg(err instanceof ApiCallError ? '改名失败' : '改名失败'),
          },
        );
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        minLength={2}
        maxLength={12}
        className="flex-1 rounded border px-3 py-1.5"
      />
      <button className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-60" disabled={rename.isPending}>
        保存
      </button>
      {msg && <span className="text-red-600">{msg}</span>}
    </form>
  );
}

function DismissDialog({
  s,
  onCancel,
  onConfirm,
}: {
  s: StudentView;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded border bg-white p-5">
        <h3 className="mb-2 font-semibold">确认开除 {s.name}？</h3>
        <p className="text-sm text-neutral-600">
          开除后该学员将被解雇并无法找回。扣除声誉 {dismissPenalty(s.qualityTier)} 点，并有 35% 概率返还 1 张改名卡。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded border px-3 py-1.5 text-sm" onClick={onCancel}>
            取消
          </button>
          <button className="rounded bg-red-600 px-3 py-1.5 text-sm text-white" onClick={onConfirm}>
            确认开除
          </button>
        </div>
      </div>
    </div>
  );
}

function dismissPenalty(t: StudentView['qualityTier']): number {
  switch (t) {
    case 'COMMON':
      return 5;
    case 'GOOD':
      return 10;
    case 'ELITE':
      return 20;
    case 'GENIUS':
      return 40;
    default:
      return 0;
  }
}
