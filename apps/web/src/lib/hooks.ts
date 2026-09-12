import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContestRecordView,
  DimensionKey,
  MeView,
  QualityTier,
  Rarity,
  StudentView,
} from '@oinur/shared';
import { apiFetch } from './api';

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
  qualityTier: QualityTier;
  hint: string;
  attrs: CandidateAttrs;
  talents: { talentId: string }[];
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
}

export type LectureTierId = 'beginner' | 'junior' | 'senior' | 'provincial' | 'national';

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
  authorId: number;
  createdAt: string;
}

export interface UserAdminView {
  id: number;
  username: string;
  role: 'USER' | 'ADMIN';
  money: number;
  reputation: number;
  bannedAt: string | null;
  deletedAt: string | null;
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

export interface TalentDefView {
  id: string;
  name: string;
  rarity: Rarity;
  kind: 'positive' | 'negative';
  description: string;
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

// ---------------------------------------------------------------------------
// 展示辅助（全局唯一；稀有度/品质/类别/维度/性别中文映射）
// ---------------------------------------------------------------------------

export const DIMENSION_LABEL: Record<DimensionKey, string> = {
  DS: '数据结构',
  DP: '动态规划',
  MATH: '数学',
  GRAPH: '图论',
  GREEDY: '贪心',
  STRING: '字符串',
};

export const QUALITY_LABEL: Record<QualityTier, string> = {
  COMMON: '普通',
  GOOD: '良好',
  ELITE: '精英',
  GENIUS: '天才',
};

export const SEX_LABEL: Record<'MALE' | 'FEMALE', string> = {
  MALE: '男',
  FEMALE: '女',
};

export const CATEGORY_LABEL: Record<string, string> = {
  nurture: '养成',
  book: '书籍',
  functional: '功能',
  contest: '竞赛',
  quest: '任务',
  material: '材料',
};

export const RARITY_LABEL: Record<Rarity, string> = {
  GRAY: '灰',
  YELLOW: '黄',
  GREEN: '绿',
  BLUE: '蓝',
  PURPLE: '紫',
  RAINBOW: '彩',
};

/** 材质色（通用着色） */
export const RARITY_TEXT: Record<Rarity, string> = {
  GRAY: 'text-neutral-500',
  YELLOW: 'text-yellow-600',
  GREEN: 'text-green-600',
  BLUE: 'text-blue-600',
  PURPLE: 'text-purple-600',
  RAINBOW: 'text-fuchsia-600',
};

/** 徽标/边框用背景色（浅底深字） */
export const RARITY_BADGE: Record<Rarity, string> = {
  GRAY: 'bg-neutral-200 text-neutral-700',
  YELLOW: 'bg-yellow-100 text-yellow-700',
  GREEN: 'bg-green-100 text-green-700',
  BLUE: 'bg-blue-100 text-blue-700',
  PURPLE: 'bg-purple-100 text-purple-700',
  RAINBOW: 'bg-fuchsia-100 text-fuchsia-700',
};

/** 归一化稀有度：API 对 items/talents 返回配置小写（如 gray），共享类型为大写 Rarity；统一大写 */
function normRarity(r: string): Rarity {
  const up = r.toUpperCase();
  return (up in RARITY_TEXT ? up : 'GRAY') as Rarity;
}

/** 稀有度中文文案 */
export function rarityLabel(r: string): string {
  return RARITY_LABEL[normRarity(r)];
}

/** 稀有度文字着色 */
export function rarityText(r: string): string {
  return RARITY_TEXT[normRarity(r)];
}

/** 稀有度徽标底色 */
export function rarityBadge(r: string): string {
  return RARITY_BADGE[normRarity(r)];
}

/** 展示层 floor：能力值为浮点累积值 */
export function floor(v: number): number {
  return Math.floor(v);
}

/** 心态：四舍五入到整数点展示 */
export function round(v: number): number {
  return Math.round(v);
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
  kind: 'basic' | 'directed' | 'specialized';
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
  kind?: 'basic' | 'directed' | 'specialized';
  limit?: number;
  cursor?: number;
}

export const TRAINING_KIND_LABEL: Record<TrainingLogView['kind'], string> = {
  basic: '基础',
  directed: '定向',
  specialized: '专项',
};

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
  });
}

export function useStudent(id: number | undefined) {
  return useQuery({
    queryKey: ['student', id],
    queryFn: () => apiFetch<StudentView>(`/api/students/${id}`),
    enabled: id != null,
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

export function useTalentDefs() {
  // 后端暂无 GET /api/talents（见报告 CONCERNS）；预留契约，返回空即优雅降级
  return useQuery({
    queryKey: ['talents'],
    queryFn: () => apiFetch<TalentDefView[]>('/api/talents'),
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// 招募
// ---------------------------------------------------------------------------

export function useAcademyPool() {
  return useQuery({
    queryKey: ['academy'],
    queryFn: () => apiFetch<PoolView>('/api/academy/pool'),
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
  });
}

export function useLectureLogs() {
  return useQuery({
    queryKey: ['lecture-logs'],
    queryFn: () => apiFetch<LectureResultView[]>('/api/academy/lectures'),
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
// 背包
// ---------------------------------------------------------------------------

export function useInventory() {
  return useQuery({
    queryKey: ['items'],
    queryFn: () => apiFetch<ItemView[]>('/api/items'),
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

export function useAdventureLogs() {
  return useQuery({
    queryKey: ['adventure-logs'],
    queryFn: () => apiFetch<AdventureLogView[]>('/api/adventures/logs'),
  });
}

export function useDrawAdventure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, tier }: { studentId: number; tier: 1 | 2 | 3 }) =>
      apiFetch<AdventureLogView>('/api/adventures/draw', {
        method: 'POST',
        body: JSON.stringify({ studentId, tier }),
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

export function useProblems() {
  // 后端暂无 GET /api/problems（见报告 CONCERNS）；预留契约，返回空即优雅降级
  return useQuery({
    queryKey: ['problems'],
    queryFn: () => apiFetch<ProblemView[]>('/api/problems'),
    retry: false,
  });
}

export function useProblemLibrary() {
  return useQuery({
    queryKey: ['problem-library'],
    queryFn: () => apiFetch<ProblemView[]>('/api/problem-library'),
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
      qc.invalidateQueries({ queryKey: ['problems'] });
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
      qc.invalidateQueries({ queryKey: ['problems'] });
    },
  });
}

export function useAdminTournaments() {
  return useQuery({
    queryKey: ['admin-tournaments'],
    queryFn: () => apiFetch<TournamentView[]>('/api/admin/tournaments'),
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
  });
}

export function useAdminUsers(query: string) {
  return useQuery({
    queryKey: ['admin-users', query],
    queryFn: () => apiFetch<UserAdminView[]>(`/api/admin/users?query=${encodeURIComponent(query)}`),
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
  });
}

export function usePvpTournaments() {
  return useQuery({
    queryKey: ['pvp-tournaments'],
    queryFn: () => apiFetch<PvpTournamentView[]>('/api/pvp/tournaments'),
  });
}

export function usePvpRegistration(tournamentId: number | undefined) {
  return useQuery({
    queryKey: ['pvp-registration', tournamentId],
    queryFn: () =>
      apiFetch<PvpRegistrationView>(`/api/pvp/tournaments/${tournamentId}/registration`),
    enabled: tournamentId !== undefined,
    retry: false,
  });
}

export function usePvpTournamentDetail(tournamentId: number | undefined) {
  return useQuery({
    queryKey: ['pvp-detail', tournamentId],
    queryFn: () => apiFetch<PvpTournamentDetailView>(`/api/pvp/tournaments/${tournamentId}`),
    enabled: tournamentId !== undefined,
  });
}

export function usePvpBracket(tournamentId: number | undefined) {
  return useQuery({
    queryKey: ['pvp-bracket', tournamentId],
    queryFn: () => apiFetch<PvpMatchView[]>(`/api/pvp/tournaments/${tournamentId}/bracket`),
    enabled: tournamentId !== undefined,
  });
}

export function usePvpRewards(tournamentId: number | undefined) {
  return useQuery({
    queryKey: ['pvp-rewards', tournamentId],
    queryFn: () => apiFetch<PvpRewardGrantView[]>(`/api/pvp/tournaments/${tournamentId}/rewards`),
    enabled: tournamentId !== undefined,
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
      studentId,
      problemEntryIds,
    }: {
      tournamentId: number;
      studentId: number;
      problemEntryIds: number[];
    }) =>
      apiFetch<PvpRegistrationView>(`/api/pvp/tournaments/${tournamentId}/register`, {
        method: 'POST',
        body: JSON.stringify({ studentId, problemEntryIds }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pvp-tournaments'] });
      qc.invalidateQueries({ queryKey: ['pvp-registration'] });
      qc.invalidateQueries({ queryKey: ['items'] });
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
      qc.invalidateQueries({ queryKey: ['problems'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['training-logs'] });
    },
  });
}

// ---------------------------------------------------------------------------
// 剧情与战报
// ---------------------------------------------------------------------------

export interface StoryStageProgress {
  stageKey: string;
  ngLevel: number;
  name?: string;
  recommendedLevel?: number;
  durationMin?: number;
  staminaCost?: number;
  unlocked: boolean;
  cleared: boolean;
  clearCount: number;
  bestRank: number | null;
  firstClearAt: string | null;
}

export interface StoryChapterView {
  chapter: string;
  stages: StoryStageProgress[];
}

export interface StoryOverview {
  ngLevel: number;
  chapters: StoryChapterView[];
  ngPlusUnlocked: boolean;
  maxUnlockedNgLevel: number;
}

export interface StoryEntryResult {
  record: ContestRecordView;
  replayed: boolean;
  firstClear: boolean;
}

export function useStoryOverview(ngLevel = 0) {
  return useQuery({
    queryKey: ['story-overview', ngLevel],
    queryFn: () => apiFetch<StoryOverview>(`/api/story/overview?ngLevel=${ngLevel}`),
  });
}

export function useStoryProgress(ngLevel?: number) {
  const query = ngLevel === undefined ? '' : `?ngLevel=${ngLevel}`;
  return useQuery({
    queryKey: ['story-progress', ngLevel ?? 'all'],
    queryFn: () =>
      apiFetch<import('@oinur/shared').StoryProgressView[]>(`/api/story/progress${query}`),
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

export function useContestRecord(recordId: string | undefined) {
  return useQuery({
    queryKey: ['contest-record', recordId],
    queryFn: () => apiFetch<ContestRecordView>(`/api/records/${recordId}`),
    enabled: recordId !== undefined,
  });
}
