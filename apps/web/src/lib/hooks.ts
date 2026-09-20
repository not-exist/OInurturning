import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BattleReplay,
  ContestRecordView,
  DimensionKey,
  MeView,
  Rarity,
  StoryOverview,
  StoryProgressView,
  StudentView,
} from '@oinur/shared';
import { apiFetch } from './api';
import type { LectureTierId, TrainingKind } from './labels';

/**
 * 数据层：wire 视图类型 + 查询/变更 hooks。
 * 展示映射一律在 lib/labels.ts（文案）与 lib/rarity.ts（色彩），本文件不再掺展示逻辑。
 *
 * 缓存分级（staleTime）：
 * - 钱包/背包/学员等玩家态 30s，且默认不在窗口聚焦时重取（见 main.tsx）：
 *   `pvp/*` 服务端每次推进都要 `SELECT ... FOR UPDATE` 行锁，聚焦重取会在同一把锁上排队；
 * - 静态配置（天赋目录/题库/讲课档位）5min；
 * - 战报与回放不可变，Infinity。
 * - 招募池例外：任何一次 GET 跨过免费刷新时刻或日界都会整池重掷，故永不自动重取
 *   （只在招募/手动刷新成功后显式失效），详见 useAcademyPool。
 */
const STALE = {
  wallet: 30_000,
  list: 30_000,
  config: 300_000,
  immutable: Infinity,
} as const;

// ---------------------------------------------------------------------------
// 领域视图类型（API 返回；shared 未导出的补于此）
// ---------------------------------------------------------------------------

export interface CandidateAttrs {
  ds: number;
  dp: number;
  math: number;
  graph: number;
  greedy: number;
  str: number;
  code: number;
  thinking: number;
  setting: number;
  focusCap: number;
  energyMax: number;
  staminaRegen: number;
}

export interface CandidatePayload {
  tempId: string;
  name: string;
  sex: 'MALE' | 'FEMALE';
  hint: string;
  attrs: CandidateAttrs;
  price: number;
}

export interface PoolView {
  candidates: CandidatePayload[];
  generatedAt: string;
  refreshesToday: number;
  refreshPrice: number;
}

export interface ItemView {
  itemId: string;
  quantity: number;
  name: string;
  rarity: Rarity;
  category: string;
  description: string;
  price: number | null;
  effectDesc: string | null;
}

export interface DismissResult {
  id: number;
  status: 'DISMISSED';
  reputationPenalty: number;
  reputationDelta: number;
  reputation: number;
  recycledRenameCard: boolean;
}

export interface RareGain {
  stat: 'code' | 'thinking' | 'setting' | 'mindset' | 'focus_cap' | 'stamina_regen';
  amount: number;
}

export interface TrainingResult {
  dim: DimensionKey;
  delta: number;
  rareGains: RareGain[];
  cost: number;
  staminaAfter: number;
  /** 同一事务内落库的训练记录 id（GET /api/training/logs 可查） */
  logId: number;
}

export interface AdventureChoiceView {
  index: number;
  text: string;
  available: boolean;
  requiresItem?: string;
  costMoney?: number;
}

export interface AdventureEventView {
  id: string;
  code: string;
  name: string;
  category: string;
  rarity: string;
  staminaCost: 1 | 2 | 3;
  description: string;
  choices: AdventureChoiceView[] | null;
}

export interface AdventureLogView {
  id: number;
  studentId: number | null;
  contestRecordId: string | null;
  tier: 1 | 2 | 3;
  status: 'PENDING' | 'RESOLVED';
  preview: boolean;
  event: AdventureEventView;
  choices: number[];
  results: unknown[];
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdventureChoiceResult {
  adventure: AdventureLogView;
  completed: boolean;
  replay?: BattleReplay;
}

export interface LectureTierView {
  id: LectureTierId;
  threshold: number;
  baseMoney: number;
  baseReputation: number;
  available: boolean;
}

export interface LectureResultView {
  id: number;
  studentId: number;
  tier: LectureTierId;
  teachingValue: number;
  threshold: number;
  forced: boolean;
  success: boolean;
  money: number;
  reputation: number;
  staminaCost: number;
  staminaAfter: number | null;
  createdAt: string;
}

export interface TournamentView {
  id: number;
  name: string;
  status: 'REGISTERING' | 'RUNNING' | 'FINISHED' | 'CANCELLED';
  size: number;
  registerEndsAt: string;
  autoStartAt: string;
  prizes: unknown;
  config: unknown;
  createdBy: number | null;
  createdAt: string;
}

export interface AnnouncementView {
  id: number;
  title: string;
  body: string;
  authorId: number | null;
  createdAt: string;
}

export interface UserAdminView {
  id: number;
  username: string;
  role: 'USER' | 'ADMIN';
  money: number;
  reputation: number;
  bannedAt: string | null;
  createdAt: string;
}

export interface AuditView {
  id: number;
  adminId: number | null;
  adminNameSnapshot: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: string;
}

export interface PvpTournamentView {
  id: number;
  name: string;
  status: 'REGISTERING' | 'RUNNING' | 'FINISHED' | 'CANCELLED';
  size: number;
  rosterSize: number;
  registerEndsAt: string;
  autoStartAt: string;
  registered: boolean;
}

export interface PvpProblemSnapshot {
  id: number;
  name: string;
  dominantDim: string;
  rarity: string;
  quality: number;
  traitId: string | null;
}

export interface PvpRegistrationView {
  id: number;
  tournamentId: number;
  userId: number;
  rosterSize: number;
  roster: import('@oinur/shared').ParticipantSnapshot[];
  problemEntryIds: number[];
  problemSnapshots: PvpProblemSnapshot[];
  createdAt: string;
  replayed: boolean;
}

export interface PvpTournamentDetailView extends PvpTournamentView {
  prizes: unknown;
  config: unknown;
  registeredCount: number;
  myRegistration: number | null;
}

export interface PvpMatchView {
  id: number;
  round: number;
  slot: number;
  homeUserId: number | null;
  awayUserId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  winnerUserId: number | null;
  status: 'PENDING' | 'DONE' | 'BYE';
  contestRecordId: string | null;
  reportUrl: string | null;
}

export type PvpRewardLine =
  | { type: 'item'; itemId: string; count: number }
  | { type: 'money'; amount: number }
  | { type: 'reputation'; amount: number };

export interface PvpRewardGrantView {
  id: number;
  tournamentId: number;
  userId: number;
  rank: number;
  rewards: PvpRewardLine[];
  claimedAt: string | null;
  claimable: boolean;
}

/** 天赋目录行（GET /api/talents；family 用于家族标签与净化链位置） */
export interface TalentDefView {
  id: string;
  name: string;
  rarity: Rarity;
  kind: 'positive' | 'negative';
  description: string;
  family: string | null;
  effects: { stat: string; mode: string; value: number }[];
}

export interface ProblemView {
  id: number;
  name: string;
  dominantDim: DimensionKey;
  rarity: Rarity;
  quality: number;
  traitId: string | null;
  consumedAt: string | null;
}

export interface CreateProblemResult extends ProblemView {
  cost: number;
  staminaAfter: number;
}

/** 当前时间的 tick（倒计时展示用，缺省每秒刷新） */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// ---------------------------------------------------------------------------
// 当前用户与总览
// ---------------------------------------------------------------------------

/** 当前用户快照（顶栏钱/声誉展示用；各 mutation 成功后统一失效 ['me']） */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<MeView>('/api/users/me'),
    staleTime: STALE.wallet,
  });
}

export type ChecklistStepId = 'train' | 'lecture' | 'adventure' | 'story' | 'recruit3';

export interface ChecklistStepView {
  id: ChecklistStepId;
  label: string;
  hint: string;
  done: boolean;
}

export interface ChecklistView {
  steps: ChecklistStepView[];
  doneCount: number;
  total: number;
  claimed: boolean;
  rewardBadge: string;
}

export interface OverviewStoryView {
  clearedStages: number;
  totalStages: number;
  nextStage: { stageKey: string; name: string; chapter: string } | null;
}

export interface OverviewPoolView {
  count: number;
  refreshPrice: number;
  freeRefreshAt: string;
}

export interface ContestRecordSummary {
  id: string;
  type: string;
  format: string;
  stageKey: string | null;
  ngLevel: number | null;
  createdAt: string;
}

export interface OverviewRecentView {
  training: TrainingLogView[];
  lectures: LectureResultView[];
  adventures: AdventureLogView[];
  contests: ContestRecordSummary[];
}

export interface OverviewView {
  me: { money: number; reputation: number; onboardedAt: string | null };
  students: { total: number; items: StudentView[] };
  story: OverviewStoryView;
  pool: OverviewPoolView;
  recent: OverviewRecentView;
  announcements: AnnouncementView[];
  checklist: ChecklistView;
}

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => apiFetch<OverviewView>('/api/overview'),
    staleTime: STALE.list,
  });
}

export function useClaimChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ claimed: boolean; already: boolean; badge: string }>(
        '/api/overview/checklist/claim',
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

// ---------------------------------------------------------------------------
// 训练记录
// ---------------------------------------------------------------------------

export interface TrainingLogView {
  id: number;
  studentId: number | null;
  studentName: string;
  kind: TrainingKind;
  dim: DimensionKey;
  delta: number;
  rareGains: RareGain[];
  cost: number;
  staminaAfter: number;
  bookItemId: string | null;
  problemId: number | null;
  createdAt: string;
}

export interface TrainingLogPage {
  items: TrainingLogView[];
  nextCursor: number | null;
}

export interface TrainingLogFilters {
  studentId?: number;
  kind?: TrainingKind;
  limit?: number;
  cursor?: number;
}

export function useTrainingLogs(filters: TrainingLogFilters = {}) {
  return useQuery({
    queryKey: [
      'training-logs',
      filters.studentId ?? null,
      filters.kind ?? null,
      filters.limit ?? null,
      filters.cursor ?? null,
    ],
    // 翻页时保留上一页，LogsList 自行拼接累积
    placeholderData: (prev) => prev,
    staleTime: STALE.list,
    queryFn: () => {
      const p = new URLSearchParams();
      if (filters.studentId !== undefined) p.set('studentId', String(filters.studentId));
      if (filters.kind !== undefined) p.set('kind', filters.kind);
      if (filters.limit !== undefined) p.set('limit', String(filters.limit));
      if (filters.cursor !== undefined) p.set('cursor', String(filters.cursor));
      const q = p.toString();
      return apiFetch<TrainingLogPage>(`/api/training/logs${q ? `?${q}` : ''}`);
    },
  });
}

// ---------------------------------------------------------------------------
// 学员
// ---------------------------------------------------------------------------

export function useStudents() {
  return useQuery({
    queryKey: ['students'],
    queryFn: () => apiFetch<StudentView[]>('/api/students'),
    staleTime: STALE.list,
  });
}

export function useStudent(id: number | undefined) {
  return useQuery({
    queryKey: ['student', id],
    queryFn: () => apiFetch<StudentView>(`/api/students/${id}`),
    enabled: id != null,
    staleTime: STALE.list,
  });
}

export function useRenameStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiFetch<StudentView>(`/api/students/${id}/rename`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['student', s.id] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useDismissStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<DismissResult>(`/api/students/${id}/dismiss`, { method: 'POST' }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['student', r.id] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

/** 天赋目录（全量 61 条，含 family 与 effects；静态配置，5min 内不重取） */
export function useTalentDefs() {
  return useQuery({
    queryKey: ['talents'],
    queryFn: () => apiFetch<TalentDefView[]>('/api/talents'),
    staleTime: STALE.config,
  });
}

// ---------------------------------------------------------------------------
// 招募与讲课
// ---------------------------------------------------------------------------

/**
 * 招募候选池。
 *
 * 永不自动重取是**正确性要求**，不是性能优化：服务端 getPool 一旦跨过
 * free_interval_hours 或日界，任意一次 GET 都会整池重掷，而 tempId 是位置编号（c0..c4），
 * 重掷后编号复用 → 「看着旧卡点新人」会静默招错人。因此只在
 * 招募成功 / 手动刷新（下方 mutation）后显式失效重取；页面另需比对 generatedAt
 * 变化并作废当前选中项。
 */
export function useAcademyPool() {
  return useQuery({
    queryKey: ['academy'],
    queryFn: () => apiFetch<PoolView>('/api/academy/pool'),
    staleTime: STALE.immutable,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useRefreshPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<PoolView>('/api/academy/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['academy'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useRecruit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tempId: string) =>
      apiFetch<StudentView>('/api/academy/recruit', {
        method: 'POST',
        body: JSON.stringify({ tempId }),
      }),
    onSuccess: () => {
      // 候选价按在册人数重算，招募后必须重取整池（价格快照禁止跨招募缓存）
      qc.invalidateQueries({ queryKey: ['academy'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useLectureTiers() {
  return useQuery({
    queryKey: ['lecture-tiers'],
    queryFn: () => apiFetch<LectureTierView[]>('/api/academy/lecture-tiers'),
    staleTime: STALE.config,
  });
}

export function useLectureLogs() {
  return useQuery({
    queryKey: ['lecture-logs'],
    queryFn: () => apiFetch<LectureResultView[]>('/api/academy/lectures'),
    staleTime: STALE.list,
  });
}

export function useTeachLecture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      studentId,
      tier,
      force,
    }: {
      studentId: number;
      tier: LectureTierId;
      force: boolean;
    }) =>
      apiFetch<LectureResultView>('/api/academy/lectures', {
        method: 'POST',
        body: JSON.stringify({ studentId, tier, force }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lecture-tiers'] });
      qc.invalidateQueries({ queryKey: ['lecture-logs'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

// ---------------------------------------------------------------------------
// 背包与道具
// ---------------------------------------------------------------------------

export function useInventory() {
  return useQuery({
    queryKey: ['items'],
    queryFn: () => apiFetch<ItemView[]>('/api/items'),
    staleTime: STALE.wallet,
  });
}

export function useUseItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, studentId }: { itemId: string; studentId?: number }) =>
      apiFetch<StudentView | { itemId: string; activated: true }>('/api/items/use', {
        method: 'POST',
        body: JSON.stringify({ itemId, studentId }),
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      if ('id' in result) qc.invalidateQueries({ queryKey: ['student', result.id] });
    },
  });
}

// ---------------------------------------------------------------------------
// 历练
// ---------------------------------------------------------------------------

export function useAdventureLogs() {
  return useQuery({
    queryKey: ['adventure-logs'],
    queryFn: () => apiFetch<AdventureLogView[]>('/api/adventures/logs'),
    staleTime: STALE.list,
  });
}

export function useDrawAdventure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roster, tier }: { roster: number[]; tier: 1 | 2 | 3 }) =>
      apiFetch<AdventureLogView>('/api/adventures/draw', {
        method: 'POST',
        body: JSON.stringify({ roster, tier }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['adventure-logs'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useChooseAdventure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      optionIndex,
      skill,
    }: {
      id: number;
      action?: 'accept' | 'avoid';
      optionIndex?: number;
      skill?: string;
    }) =>
      apiFetch<AdventureChoiceResult>(`/api/adventures/${id}/choice`, {
        method: 'POST',
        body: JSON.stringify({ action, optionIndex, skill }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['adventure-logs'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

// ---------------------------------------------------------------------------
// 训练
// ---------------------------------------------------------------------------

export interface DirectedTrainInput {
  studentId: number;
  dim: DimensionKey;
  bookItemId?: string;
}

/** 账号级题库（GET /api/problem-library；与 /api/problems 同源，数据层只留这一个） */
export function useProblemLibrary() {
  return useQuery({
    queryKey: ['problem-library'],
    queryFn: () => apiFetch<ProblemView[]>('/api/problem-library'),
    staleTime: STALE.config,
  });
}

export function useCreateProblem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, dimension }: { studentId: number; dimension: DimensionKey }) =>
      apiFetch<CreateProblemResult>('/api/problem-library', {
        method: 'POST',
        body: JSON.stringify({ studentId, dimension }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['problem-library'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useDeleteProblem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<null>(`/api/problem-library/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['problem-library'] });
    },
  });
}

export function useBasicTrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (studentId: number) =>
      apiFetch<TrainingResult>('/api/training/basic', {
        method: 'POST',
        body: JSON.stringify({ studentId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['training-logs'] });
    },
  });
}

export function useDirectedTrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DirectedTrainInput) =>
      apiFetch<TrainingResult>('/api/training/directed', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['training-logs'] });
    },
  });
}

export function useSpecializedTrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, problemId }: { studentId: number; problemId: number }) =>
      apiFetch<TrainingResult>('/api/training/specialized', {
        method: 'POST',
        body: JSON.stringify({ studentId, problemId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['problem-library'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['training-logs'] });
    },
  });
}

// ---------------------------------------------------------------------------
// 管理端
// ---------------------------------------------------------------------------

export function useAdminTournaments() {
  return useQuery({
    queryKey: ['admin-tournaments'],
    queryFn: () => apiFetch<TournamentView[]>('/api/admin/tournaments'),
    staleTime: STALE.list,
  });
}

export function useCreateTournament() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      size: 8 | 16 | 32;
      registerEndsAt: string;
      autoStartAt: string;
      prizes: Record<string, unknown>;
      config: Record<string, unknown>;
    }) =>
      apiFetch<TournamentView>('/api/admin/tournaments', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tournaments'] });
      qc.invalidateQueries({ queryKey: ['admin-audits'] });
    },
  });
}

export function useUpdateTournamentPrizes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tournamentId,
      prizes,
    }: {
      tournamentId: number;
      prizes: Record<string, unknown>;
    }) =>
      apiFetch<TournamentView>(`/api/admin/pvp-tournaments/${tournamentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ prizes }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tournaments'] });
      qc.invalidateQueries({ queryKey: ['admin-audits'] });
    },
  });
}

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ title, body }: { title: string; body: string }) =>
      apiFetch<AnnouncementView>('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({ title, body }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-announcements'] });
      qc.invalidateQueries({ queryKey: ['admin-audits'] });
    },
  });
}

export function useAdminAnnouncements() {
  return useQuery({
    queryKey: ['admin-announcements'],
    queryFn: () => apiFetch<AnnouncementView[]>('/api/admin/announcements'),
    staleTime: STALE.list,
  });
}

export function useAdminUsers(query: string) {
  return useQuery({
    queryKey: ['admin-users', query],
    queryFn: () => apiFetch<UserAdminView[]>(`/api/admin/users?query=${encodeURIComponent(query)}`),
    staleTime: STALE.list,
  });
}

export function useSetUserBan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, banned }: { userId: number; banned: boolean }) =>
      apiFetch<UserAdminView>(`/api/admin/users/${userId}/${banned ? 'ban' : 'unban'}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-audits'] });
    },
  });
}

export function useAdminAudits() {
  return useQuery({
    queryKey: ['admin-audits'],
    queryFn: () => apiFetch<AuditView[]>('/api/admin/audits'),
    staleTime: STALE.list,
  });
}

// ---------------------------------------------------------------------------
// PVP
// ---------------------------------------------------------------------------

export function usePvpTournaments() {
  return useQuery({
    queryKey: ['pvp-tournaments'],
    queryFn: () => apiFetch<PvpTournamentView[]>('/api/pvp/tournaments'),
    staleTime: STALE.list,
  });
}

export function usePvpRegistration(tournamentId: number | undefined) {
  return useQuery({
    queryKey: ['pvp-registration', tournamentId],
    queryFn: () =>
      apiFetch<PvpRegistrationView>(`/api/pvp/tournaments/${tournamentId}/registration`),
    enabled: tournamentId !== undefined,
    retry: false,
    staleTime: STALE.list,
  });
}

/**
 * 赛事详情/对阵表/奖励公示。
 * `terminal = true`（已结束或已取消）后不再重取：服务端每次推进都拿行锁并全量跑奖励 upsert，
 * 终态数据不会再变，重取只有锁竞争成本。
 */
export function usePvpTournamentDetail(tournamentId: number | undefined, terminal = false) {
  return useQuery({
    queryKey: ['pvp-detail', tournamentId],
    queryFn: () => apiFetch<PvpTournamentDetailView>(`/api/pvp/tournaments/${tournamentId}`),
    enabled: tournamentId !== undefined,
    staleTime: terminal ? STALE.immutable : STALE.list,
  });
}

export function usePvpBracket(tournamentId: number | undefined, terminal = false) {
  return useQuery({
    queryKey: ['pvp-bracket', tournamentId],
    queryFn: () => apiFetch<PvpMatchView[]>(`/api/pvp/tournaments/${tournamentId}/bracket`),
    enabled: tournamentId !== undefined,
    staleTime: terminal ? STALE.immutable : STALE.list,
  });
}

export function usePvpRewards(tournamentId: number | undefined, terminal = false) {
  return useQuery({
    queryKey: ['pvp-rewards', tournamentId],
    queryFn: () => apiFetch<PvpRewardGrantView[]>(`/api/pvp/tournaments/${tournamentId}/rewards`),
    enabled: tournamentId !== undefined,
    staleTime: terminal ? STALE.immutable : STALE.list,
  });
}

export function useClaimPvpReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tournamentId: number) =>
      apiFetch<PvpRewardGrantView>(`/api/pvp/tournaments/${tournamentId}/rewards/claim`, {
        method: 'POST',
      }),
    onSuccess: (_, tournamentId) => {
      qc.invalidateQueries({ queryKey: ['pvp-rewards', tournamentId] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useRegisterPvp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tournamentId,
      studentIds,
      problemEntryIds,
    }: {
      tournamentId: number;
      studentIds: number[];
      problemEntryIds: number[];
    }) =>
      apiFetch<PvpRegistrationView>(`/api/pvp/tournaments/${tournamentId}/register`, {
        method: 'POST',
        body: JSON.stringify({ studentIds, problemEntryIds }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pvp-tournaments'] });
      qc.invalidateQueries({ queryKey: ['pvp-registration'] });
      qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

// ---------------------------------------------------------------------------
// 剧情与战报
// ---------------------------------------------------------------------------

export interface StoryEntryResult {
  record: ContestRecordView;
  replay: BattleReplay;
  replayed: boolean;
  firstClear: boolean;
}

export function useStoryOverview(ngLevel = 0) {
  return useQuery({
    queryKey: ['story-overview', ngLevel],
    queryFn: () => apiFetch<StoryOverview>(`/api/story/overview?ngLevel=${ngLevel}`),
    staleTime: STALE.list,
  });
}

export function useStoryProgress(ngLevel?: number) {
  const query = ngLevel === undefined ? '' : `?ngLevel=${ngLevel}`;
  return useQuery({
    queryKey: ['story-progress', ngLevel ?? 'all'],
    queryFn: () => apiFetch<StoryProgressView[]>(`/api/story/progress${query}`),
    staleTime: STALE.list,
  });
}

export function useEnterStoryStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      stageKey,
      roster,
      ngLevel,
      idempotencyKey,
    }: {
      stageKey: string;
      roster: number[];
      ngLevel: number;
      idempotencyKey: string;
    }) =>
      apiFetch<StoryEntryResult>(`/api/story/stages/${encodeURIComponent(stageKey)}/enter`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ roster, ngLevel }),
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['story-overview'] });
      qc.invalidateQueries({ queryKey: ['story-progress'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      return result;
    },
  });
}

/** 战报不可变：一次取到即终态 */
export function useContestRecord(recordId: string | undefined) {
  return useQuery({
    queryKey: ['contest-record', recordId],
    queryFn: () => apiFetch<ContestRecordView>(`/api/records/${recordId}`),
    enabled: recordId !== undefined,
    retry: false,
    staleTime: STALE.immutable,
  });
}

/** 回放不可变：一次取到即终态 */
export function useContestReplay(recordId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['contest-replay', recordId],
    queryFn: () => apiFetch<BattleReplay>(`/api/records/${recordId}/replay`),
    enabled: recordId !== undefined && enabled,
    retry: false,
    staleTime: STALE.immutable,
  });
}
