import { useState, type JSX } from 'react';
import { apiErrorMessage } from '../../lib/api';
import {
  rarityBadge,
  useAdventureLogs,
  useChooseAdventure,
  useDrawAdventure,
  useInventory,
  useStudents,
  useUseItem,
  type AdventureLogView,
} from '../../lib/hooks';
import { Empty } from '../../components/ui';

const RARITY_LABEL: Record<string, string> = {
  gray: '灰',
  yellow: '黄',
  green: '绿',
  blue: '蓝',
  purple: '紫',
  colorful: '彩',
};

function resultRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resultLabel(value: unknown): string {
  const result = resultRecord(value);
  if (result.status === 'AVOIDED') return '已回避，未消耗体力。';
  const rewards = Array.isArray(result.rewards) ? result.rewards : [];
  const rewardText = rewards
    .map((reward) => {
      const item = resultRecord(reward);
      if (item.type === 'money') return `钱 ${Number(item.amount) > 0 ? '+' : ''}${item.amount}`;
      if (item.type === 'reputation')
        return `声誉 ${Number(item.amount) > 0 ? '+' : ''}${item.amount}`;
      if (item.type === 'item') return `道具 ${item.itemId} ×${item.count}`;
      if (item.type === 'consume_item') return `消耗 ${item.itemId} ×${item.count}`;
      if (item.type === 'buff') return '获得临时增益';
      return null;
    })
    .filter((text): text is string => text !== null);
  const check = resultRecord(result.check);
  const checkText =
    typeof check.skill === 'string' ? `检定 ${check.success ? '通过' : '未通过'}` : null;
  return (
    [checkText, ...rewardText].filter((text): text is string => text !== null).join(' · ') ||
    '事件已结算。'
  );
}

function EventCard({
  adventure,
  onChoice,
  onPreview,
  pending,
}: {
  adventure: AdventureLogView;
  onChoice: (optionIndex: number) => void;
  onPreview: (action: 'accept' | 'avoid') => void;
  pending: boolean;
}): JSX.Element {
  const choices = adventure.event.choices;
  return (
    <section className="border border-neutral-300 bg-white p-5" aria-labelledby="active-event">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
            {adventure.event.code} · 体力 {adventure.tier}
          </p>
          <h2 id="active-event" className="mt-1 text-xl font-semibold">
            {adventure.event.name}
          </h2>
        </div>
        <span
          className={`rounded px-2 py-1 text-xs font-medium ${rarityBadge(adventure.event.rarity)}`}
        >
          {RARITY_LABEL[adventure.event.rarity] ?? adventure.event.rarity}
        </span>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-700">
        {adventure.event.description}
      </p>

      {adventure.preview ? (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-neutral-200 pt-4">
          <button
            type="button"
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={pending}
            onClick={() => onPreview('accept')}
          >
            接受历练
          </button>
          <button
            type="button"
            className="rounded border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50"
            disabled={pending}
            onClick={() => onPreview('avoid')}
          >
            回避
          </button>
        </div>
      ) : adventure.status === 'PENDING' && choices !== null ? (
        <div className="mt-5 space-y-2 border-t border-neutral-200 pt-4">
          {choices.map((choice) => (
            <button
              key={choice.index}
              type="button"
              disabled={!choice.available || pending}
              className="flex w-full items-center justify-between gap-3 rounded border border-neutral-300 px-3 py-3 text-left text-sm hover:border-neutral-900 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
              onClick={() => onChoice(choice.index)}
            >
              <span>{choice.text}</span>
              <span className="shrink-0 text-xs text-neutral-500">
                {choice.costMoney === undefined ? '' : `钱 ${choice.costMoney}`}
                {choice.requiresItem === undefined ? '' : ` · ${choice.requiresItem}`}
                {!choice.available ? ' · 暂不可用' : ''}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-5 border-t border-neutral-200 pt-4 text-sm text-neutral-700">
          {adventure.results.map((result, index) => (
            <p key={index}>{resultLabel(result)}</p>
          ))}
        </div>
      )}
    </section>
  );
}

export function AdventurePage(): JSX.Element {
  const students = useStudents();
  const inventory = useInventory();
  const logs = useAdventureLogs();
  const draw = useDrawAdventure();
  const choose = useChooseAdventure();
  const activate = useUseItem();
  const [studentId, setStudentId] = useState<number>();
  const [tier, setTier] = useState<1 | 2 | 3>(1);
  const [active, setActive] = useState<AdventureLogView>();
  const [intelReady, setIntelReady] = useState(false);

  if (students.isPending || inventory.isPending || logs.isPending) {
    return (
      <div className="flex items-center gap-2 text-neutral-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
        加载历练数据…
      </div>
    );
  }
  if (
    students.isError ||
    inventory.isError ||
    logs.isError ||
    !students.data ||
    !inventory.data ||
    !logs.data
  ) {
    return (
      <div className="space-y-2 text-sm text-red-600">
        <p>历练数据加载失败：{apiErrorMessage(students.error ?? inventory.error ?? logs.error)}</p>
        <button
          className="rounded border px-3 py-1 text-xs"
          onClick={() => {
            void students.refetch();
            void inventory.refetch();
            void logs.refetch();
          }}
        >
          重试
        </button>
      </div>
    );
  }

  const selectedStudentId = studentId ?? students.data[0]?.id;
  const pending = active ?? logs.data.find((log) => log.status === 'PENDING');
  const intel = inventory.data.find((item) => item.itemId === 'intel-slip');
  const drawError = draw.isError ? '抽取失败，请检查体力或当前待处理事件。' : null;
  const chooseError = choose.isError ? '结算失败，请检查选项条件。' : null;

  const drawEvent = () => {
    if (selectedStudentId === undefined) return;
    draw.mutate(
      { studentId: selectedStudentId, tier },
      { onSuccess: (result) => setActive(result) },
    );
  };
  const chooseEvent = (input: { action?: 'accept' | 'avoid'; optionIndex?: number }) => {
    if (pending === undefined) return;
    choose.mutate(
      { id: pending.id, ...input },
      {
        onSuccess: (result) => setActive(result.completed ? undefined : result.adventure),
      },
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-b border-neutral-300 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
          Adventure Log
        </p>
        <h1 className="mt-1 text-2xl font-semibold">历练</h1>
        <p className="mt-2 text-sm text-neutral-500">
          把体力投入一次未知遭遇，带回资源、成长或新的线索。
        </p>
      </div>

      <section className="grid gap-4 border-b border-neutral-200 pb-5 md:grid-cols-[1fr_auto] md:items-end">
        <label className="text-sm">
          <span className="mb-2 block text-neutral-500">出发学员</span>
          <select
            className="w-full rounded border border-neutral-300 bg-white px-3 py-2 md:min-w-64"
            value={selectedStudentId ?? ''}
            onChange={(event) => setStudentId(Number(event.target.value))}
          >
            {students.data.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name} · 体力 {Math.floor(student.stamina)} · V {student.v}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-2 block text-sm text-neutral-500">投入体力</span>
          <div className="flex gap-1">
            {([1, 2, 3] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tier === value}
                className={`min-w-12 rounded border px-3 py-2 text-sm ${tier === value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white'}`}
                onClick={() => setTier(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </section>

      {students.data.length === 0 && (
        <Empty icon="🧭" title="还没有可以历练的学员">
          招募学员后即可投入体力探索未知事件。
        </Empty>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
          disabled={selectedStudentId === undefined || pending !== undefined || draw.isPending}
          onClick={drawEvent}
        >
          {draw.isPending ? '抽取中…' : '开始历练'}
        </button>
        <button
          type="button"
          className={`rounded border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${intelReady ? 'border-blue-600 text-blue-700' : 'border-neutral-300'}`}
          disabled={intelReady || (intel?.quantity ?? 0) < 1 || activate.isPending}
          onClick={() =>
            activate.mutate({ itemId: 'intel-slip' }, { onSuccess: () => setIntelReady(true) })
          }
        >
          {intelReady ? '情报已激活' : `激活情报 · ${intel?.quantity ?? 0}`}
        </button>
        {drawError && <span className="text-sm text-red-600">{drawError}</span>}
        {chooseError && <span className="text-sm text-red-600">{chooseError}</span>}
      </div>

      {pending && (
        <EventCard
          adventure={pending}
          pending={choose.isPending}
          onPreview={(action) => chooseEvent({ action })}
          onChoice={(optionIndex) => chooseEvent({ optionIndex })}
        />
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between border-b border-neutral-300 pb-2">
          <h2 className="text-lg font-semibold">历练记录</h2>
          <span className="text-xs text-neutral-500">最近 {logs.data.length} 条</span>
        </div>
        {logs.data.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无记录。</p>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200 bg-white">
            {logs.data.map((log) => (
              <li
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm"
              >
                <div>
                  <span className="font-medium">{log.event.name}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {log.event.code} · 体力 {log.tier}
                  </span>
                </div>
                <div className="text-right text-xs text-neutral-500">
                  <span>{log.status === 'PENDING' ? '待处理' : resultLabel(log.results[0])}</span>
                  <time className="ml-3">{new Date(log.createdAt).toLocaleString()}</time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
