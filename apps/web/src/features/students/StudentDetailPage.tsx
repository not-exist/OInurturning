import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { StudentView } from '@oinur/shared';
import { ArrowLeft, PenLine, UserX } from 'lucide-react';
import { apiErrorMessage } from '../../lib/api';
import {
  useDismissStudent,
  useInventory,
  useRenameStudent,
  useStudent,
  useTalentDefs,
  type TalentDefView,
} from '../../lib/hooks';
import {
  ABILITY_LABEL,
  DIMENSION_LABEL,
  QUALITY_LABEL,
  RENAME_CARD_ID,
  SEX_LABEL,
  STUDENT_STATUS_LABEL,
  floor,
  signed,
} from '../../lib/labels';
import { QUALITY_MATERIAL } from '../../lib/rarity';
import { Btn, Chip, ErrorNote, InlineLoader, Meter, Modal, Numeral, Panel } from '../../components/ui';
import { DIMENSION_ICON, Icon, type LucideIcon } from '../../components/icons';
import {
  ABILITY_ROWS,
  MindsetBar,
  QualityBadge,
  RadarChart,
  SIX_DIMS,
  StaminaCells,
  TalentSlot,
  mindsetBaseline,
  staminaIntervalMin,
} from './StudentVisuals';

/** 学员档案：雷达 + 九维 + 天赋槽 + 改名 / 开除。 */
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
  const [pageMsg, setPageMsg] = useState<string | null>(null);
  const [dismissMsg, setDismissMsg] = useState<string | null>(null);

  const defs = useMemo(
    () => new Map<string, TalentDefView>((talentsQ.data ?? []).map((t) => [t.id, t])),
    [talentsQ.data],
  );

  if (q.isLoading) return <InlineLoader>学员档案读取中…</InlineLoader>;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-3">
        <ErrorNote onRetry={() => void q.refetch()}>
          学员档案读取失败：该学员可能已被开除或不属于当前账号。
        </ErrorNote>
        <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-fg-dim hover:text-fg">
          <Icon icon={ArrowLeft} className="size-4" />
          返回学员列表
        </Link>
      </div>
    );
  }

  const s = q.data;
  const renameCards = invQ.data?.find((i) => i.itemId === RENAME_CARD_ID)?.quantity ?? 0;
  const baseline = mindsetBaseline(s.talents, defs);
  const regenMin = staminaIntervalMin(s.staminaRegen);

  return (
    <div className="space-y-4" data-testid="student-detail-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/students"
          className="inline-flex items-center gap-1.5 text-sm text-fg-dim transition-colors hover:text-fg"
        >
          <Icon icon={ArrowLeft} className="size-4" />
          返回学员列表
        </Link>
        <Btn
          data-testid="dismiss-open"
          variant="danger"
          disabled={dismiss.isPending}
          onClick={() => {
            setDismissMsg(null);
            setDismissOpen(true);
          }}
        >
          <Icon icon={UserX} className="size-3.5" />
          开除学员
        </Btn>
      </div>

      {/* 档案主卡：品质档走材质层级（不复用稀有度色相） */}
      <section className={`panel panel-corners ${QUALITY_MATERIAL[s.qualityTier]} p-4 sm:p-5`}>
        <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
          <RadarChart s={s} size={132} className="mx-auto lg:mx-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
              <QualityBadge tier={s.qualityTier} />
              <Chip>{SEX_LABEL[s.sex]}</Chip>
              <Chip>{STUDENT_STATUS_LABEL[s.status]}</Chip>
            </div>

            <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <p className="text-fg-muted">
                <span className="eyebrow mr-2">综合评定 V</span>{' '}
                <Numeral value={floor(s.v)} className="text-4xl text-fg" />
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Btn
                  data-testid="rename-toggle"
                  disabled={renameCards < 1}
                  onClick={() => setRenameOpen((v) => !v)}
                  title={renameCards < 1 ? '需要改名卡（背包内获取）' : '消耗 1 张改名卡'}
                >
                  <Icon icon={PenLine} className="size-3.5" />
                  改名（拥有 {renameCards} 张改名卡）
                </Btn>
                {renameCards < 1 && (
                  <span className="text-xs text-fg-faint">改名卡可在背包或历练中获得</span>
                )}
              </div>
            </div>
            {renameOpen && renameCards >= 1 && (
              <RenameForm s={s} onDone={() => setRenameOpen(false)} onError={setPageMsg} />
            )}
            {pageMsg !== null && (
              <p data-testid="student-msg" className="mt-2 border border-bad-400/40 bg-bad-400/10 px-3 py-2 text-sm text-bad-400">
                {pageMsg}
              </p>
            )}
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <VitalCell label="心态">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xl text-fg">{signed(s.mindset)}</span>
              <span className="text-[10px] text-fg-faint">−10 … +10</span>
            </div>
            <MindsetBar value={s.mindset} baseline={baseline} />
          </VitalCell>
          <VitalCell label="体力">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xl text-fg">{floor(s.stamina)}/5</span>
              <span className="text-[10px] text-fg-faint">{regenMin} 分钟/点</span>
            </div>
            <StaminaCells stamina={s.stamina} className="mt-1.5" />
          </VitalCell>
          <VitalCell label="精力">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xl text-fg">
                {floor(s.energy)}/{floor(s.energyMax)}
              </span>
              <span className="text-[10px] text-fg-faint">上限 {floor(s.energyMax)}</span>
            </div>
            <Meter value={s.energy} max={s.energyMax} className="mt-1.5 bg-good-400/80" />
          </VitalCell>
          <VitalCell label="专注上限">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xl text-fg">{floor(s.focusCap)}</span>
              <span className="text-[10px] text-fg-faint">体力恢复 {floor(s.staminaRegen)}</span>
            </div>
            <p className="mt-1 text-[11px] text-fg-dim">比赛开始时专注为 0，靠做题提速积累。</p>
          </VitalCell>
        </dl>
      </section>

      <Panel title="九维能力" eyebrow="ABILITY MATRIX">
        <div className="grid gap-x-8 gap-y-2.5 lg:grid-cols-2">
          {ABILITY_ROWS.map((row) => (
            <AbilityRow
              key={row.key}
              label={ABILITY_LABEL[row.key]}
              icon={DIMENSION_ICON[row.key]}
              value={s[row.field]}
            />
          ))}
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-2.5 border-t border-ink-600/60 pt-4 lg:grid-cols-2">
          {SIX_DIMS.map((dim) => (
            <AbilityRow
              key={dim.key}
              label={DIMENSION_LABEL[dim.key]}
              icon={DIMENSION_ICON[dim.key]}
              value={s[dim.field]}
            />
          ))}
        </div>
      </Panel>

      <Panel title="天赋" eyebrow="TALENTS" actions={<Chip>{s.talents.length} 枚</Chip>}>
        {s.talents.length === 0 ? (
          <p className="text-sm text-fg-faint">该学员暂无天赋，可通过历练与洗练获得。</p>
        ) : (
          <div className="space-y-2">
            {s.talents.map((tid) => {
              const def = defs.get(tid);
              return def !== undefined ? (
                <TalentSlot key={tid} def={def} />
              ) : (
                <p key={tid} className="border border-ink-600 px-3 py-2.5 text-sm text-fg-faint">
                  天赋条目尚未同步，稍后重试。
                </p>
              );
            })}
          </div>
        )}
      </Panel>

      <Modal
        open={dismissOpen}
        onClose={() => setDismissOpen(false)}
        title={`确认开除 ${s.name}？`}
        eyebrow="DISMISS"
        width="max-w-md"
        testId="dismiss-dialog"
      >
        <p className="text-sm text-fg-muted">
          开除后该学员将被解雇并无法找回，并有 35% 概率返还 1 张改名卡。
        </p>
        <dl className="mt-3 space-y-1 border-t border-ink-600/60 pt-3">
          <div className="flex items-center justify-between text-xs">
            <dt className="text-fg-dim">品质档</dt>
            <dd className="text-fg">{QUALITY_LABEL[s.qualityTier]}</dd>
          </div>
          <div className="flex items-center justify-between text-xs">
            <dt className="text-fg-dim">声誉扣除</dt>
            <dd className="font-mono text-bad-400">−{dismissPenalty(s.qualityTier)}</dd>
          </div>
        </dl>
        {dismissMsg !== null && <p className="mt-3 text-sm text-bad-400">{dismissMsg}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setDismissOpen(false)}>取消</Btn>
          <Btn
            data-testid="dismiss-confirm"
            variant="danger"
            disabled={dismiss.isPending}
            onClick={() => {
              dismiss.mutate(s.id, {
                onError: (e) => setDismissMsg(`开除失败：${apiErrorMessage(e)}`),
                onSuccess: () => {
                  setDismissOpen(false);
                  nav('/students');
                },
              });
            }}
          >
            {dismiss.isPending ? '开除中…' : '确认开除'}
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

function VitalCell({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="border border-ink-600/70 bg-ink-850/50 px-3 py-2.5">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  );
}

function AbilityRow({
  label,
  icon,
  value,
}: {
  label: string;
  icon: LucideIcon;
  value: number;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      <Icon icon={icon} className="size-3.5 shrink-0 text-fg-faint" />
      <span className="w-16 shrink-0 truncate text-xs text-fg-dim">{label}</span>
      <span className="min-w-0 flex-1">
        <Meter value={value} max={100} className="bg-cyber-400/70" />
      </span>
      <span className="w-8 shrink-0 text-right font-mono text-sm text-fg">{floor(value)}</span>
    </div>
  );
}

function RenameForm({
  s,
  onDone,
  onError,
}: {
  s: StudentView;
  onDone: () => void;
  onError: (msg: string | null) => void;
}): JSX.Element {
  const rename = useRenameStudent();
  const [name, setName] = useState(s.name);

  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onError(null);
        rename.mutate(
          { id: s.id, name },
          { onSuccess: () => onDone(), onError: (err) => onError(`改名失败：${apiErrorMessage(err)}`) },
        );
      }}
    >
      <input
        data-testid="rename-input"
        aria-label="新名字"
        value={name}
        onChange={(e) => setName(e.target.value)}
        minLength={2}
        maxLength={12}
        className="w-48 border border-ink-600 bg-ink-850 px-3 py-1.5 text-sm"
      />
      <Btn type="submit" data-testid="rename-save" variant="primary" disabled={rename.isPending}>
        {rename.isPending ? '保存中…' : '保存'}
      </Btn>
      <span className="text-xs text-fg-faint">2–12 个字符，消耗 1 张改名卡</span>
    </form>
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
