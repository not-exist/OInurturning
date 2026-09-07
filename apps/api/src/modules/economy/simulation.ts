import { lectureConfigSchema, type EconomyConfig, type ItemDef, type SimulationProfile, type StageConfig } from '@oinur/shared';

export interface SimulationInput { economy: EconomyConfig; items: Record<string, ItemDef>; stages: Record<string, StageConfig> }
export interface SimulationLine { key: string; amount: number }
export interface ProfileSimulation {
  id: 'beginner' | 'mid' | 'late'; label: string; income: SimulationLine[]; expenses: SimulationLine[];
  incomeTotal: number; expenseTotal: number; net: number; ratio: number | null;
}
export interface EconomySimulationReport {
  profiles: ProfileSimulation[];
  target: { profileId: string; min: number; max: number; actual: number | null; pass: boolean };
}

function moneyLine(key: string, amount: number): SimulationLine { return { key, amount: Math.round(amount) }; }
function midpoint(range: { min: number; max: number }): number { return (range.min + range.max) / 2; }
function weightedAverage(weights: Record<string, number>, values: Record<string, number>): number {
  const entries = Object.entries(weights).filter(([key, weight]) => weight > 0 && Number.isFinite(weight) && Number.isFinite(values[key]));
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return totalWeight === 0 ? 0 : entries.reduce((sum, [key, weight]) => sum + (weight / totalWeight) * values[key]!, 0);
}
const round = Math.round;
const DAYS_PER_WEEK = 7;

type RankTier = SimulationProfile['story']['rank_tier'];

interface EconomySimulationSections {
  meta?: { calibration_profile?: { target_income_expense_ratio?: unknown } };
  contest?: {
    rank_coeffs?: Partial<Record<RankTier, unknown>>;
    ngplus_money_multiplier?: { formula?: unknown };
  };
  adventure?: { money_ranges_by_rarity?: Record<string, { min: number; max: number }> };
  passive?: {
    sponsor_contract_p4?: { daily_income_min: number; daily_income_max: number; contract_days: number };
    substitute_coach_y6?: { tier_cap: string; player_share_ratio: number; passive_lectures_per_week: number };
  };
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path}: missing or invalid number`);
  return value;
}

function targetRatioRange(value: unknown): [number, number] {
  const min = Array.isArray(value) ? value[0] : undefined;
  const max = Array.isArray(value) ? value[1] : undefined;
  if (value === undefined || !Array.isArray(value) || value.length !== 2 || typeof min !== 'number' || !Number.isFinite(min) || typeof max !== 'number' || !Number.isFinite(max)) {
    throw new Error('meta.calibration_profile.target_income_expense_ratio: expected finite [min, max]');
  }
  return [min, max];
}

export function simulateEconomy(input: SimulationInput): EconomySimulationReport {
  const economy = input.economy as EconomyConfig & EconomySimulationSections;
  const simulation = economy.simulation;
  if (!simulation) throw new Error('economy.simulation is required');
  const training = economy.training;
  const recruitment = economy.recruitment;
  const lectureResult = lectureConfigSchema.safeParse(economy.lecture);
  if (!lectureResult.success) throw new Error('lecture: complete lecture configuration is required');
  const lecture = lectureResult.data;
  const contest = economy.contest ?? {};
  const adventure = economy.adventure;
  const passive = economy.passive;
  if (!passive) throw new Error('passive: configuration is required');
  const rawRankCoeffs = contest.rank_coeffs ?? {};
  const rankCoeffs: Record<RankTier, number> = {
    champion: finiteNumber(rawRankCoeffs.champion, 'contest.rank_coeffs.champion'),
    runner_up: finiteNumber(rawRankCoeffs.runner_up, 'contest.rank_coeffs.runner_up'),
    third_to_eighth: finiteNumber(rawRankCoeffs.third_to_eighth, 'contest.rank_coeffs.third_to_eighth'),
  };
  const ngFormula = String(contest.ngplus_money_multiplier?.formula ?? '');
  const ngMatch = ngFormula.match(/^\s*mult\(k\)\s*=\s*1\s*\+\s*([0-9]+(?:\.[0-9]+)?)\s*\*\s*k\s*$/);
  if (!ngMatch) throw new Error('contest.ngplus_money_multiplier.formula: expected "1 + coefficient * k"');
  const ngCoeff = Number(ngMatch[1]);
  const targetRange = targetRatioRange(economy.meta?.calibration_profile?.target_income_expense_ratio);
  const order = ['beginner', 'mid', 'late'] as const;
  const profiles: ProfileSimulation[] = order.map((id) => {
    const profile = simulation.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error(`simulation.profiles.${id}: missing profile`);
    const income: SimulationLine[] = [];
    const expenses: SimulationLine[] = [];
    const scale = 1 + training.student_coeff * (profile.owned_students - 1);
    const basic = round(training.basic.money_base * scale) * profile.training.basic_sessions;
    const directed = round(training.directed.money_base * scale) * profile.training.directed_sessions;
    const specialized = round(training.specialized.money_base * scale) * profile.training.specialized_sessions;
    expenses.push(moneyLine('training.basic', basic), moneyLine('training.directed', directed), moneyLine('training.specialized', specialized));
    const book = input.items[profile.training.directed_book_item_id];
    if (!book) throw new Error(`simulation.profiles.${profile.id}.training.directed_book_item_id: missing item ${profile.training.directed_book_item_id}`);
    if (book.price == null) throw new Error(`simulation.profiles.${profile.id}.training.directed_book_item_id: item has no price`);
    expenses.push(moneyLine('books.directed', book.price * training.directed.book_consumed * profile.training.directed_sessions));
    const recruitUnit = round(recruitment.recruit_base * recruitment.recruit_growth ** profile.owned_students) * recruitment.quality_mult[profile.recruitment.quality];
    expenses.push(moneyLine('recruitment', recruitUnit * profile.recruitment.recruits_per_week));
    const refreshCfg = recruitment.manual_refresh;
    const refreshes = profile.recruitment.manual_refreshes_per_week;
    const wholeRefreshes = Math.floor(refreshes);
    let refreshCost = 0;
    for (let index = 0; index < wholeRefreshes; index += 1) {
      refreshCost += Math.min(refreshCfg.daily_price_cap, round(refreshCfg.refresh_base * refreshCfg.refresh_growth ** index));
    }
    const fractionalRefresh = refreshes - wholeRefreshes;
    if (fractionalRefresh > 0) refreshCost += fractionalRefresh * Math.min(refreshCfg.daily_price_cap, round(refreshCfg.refresh_base * refreshCfg.refresh_growth ** wholeRefreshes));
    expenses.push(moneyLine('recruitment.refresh', refreshCost));
    expenses.push(moneyLine('fixed', profile.fixed_weekly_expense));

    const tier = lecture.audience_tiers.find((entry) => entry.id === profile.lectures.tier);
    if (!tier) throw new Error(`simulation.profiles.${profile.id}.lectures.tier: missing lecture tier ${profile.lectures.tier}`);
    const repCurve = lecture.reputation_pay_curve;
    const repMult = Math.max(repCurve.min_mult, Math.min(repCurve.max_mult, 1 + profile.reputation / repCurve.rep_divisor));
    const overflow = Math.min(lecture.overflow_bonus.overflow_cap_pct, Math.max(0, Math.floor(Math.max(0, profile.ability - tier.threshold) / lecture.overflow_bonus.overflow_step) * lecture.overflow_bonus.overflow_pct));
    income.push(moneyLine('lectures', round(tier.base_money * repMult * (1 + overflow)) * profile.lectures.sessions));
    const ranges = adventure?.money_ranges_by_rarity;
    if (!ranges) throw new Error('adventure.money_ranges_by_rarity: configuration is required');
    const values = Object.fromEntries(Object.entries(ranges).map(([key, range]) => [key, midpoint(range)]));
    income.push(moneyLine('adventures', weightedAverage(profile.adventures.rarity_mix, values) * profile.adventures.sessions));
    const stage = input.stages[profile.story.stage_key];
    if (!stage) throw new Error(`simulation.profiles.${profile.id}.story.stage_key: missing stage ${profile.story.stage_key}`);
    const chapterStage = Object.values(input.stages).find((candidate) => candidate.chapter === stage.chapter && candidate.stage_index === 1) ?? stage;
    const ngMult = 1 + ngCoeff * profile.story.ng_level;
    income.push(moneyLine('story', (chapterStage.first_clear.money * rankCoeffs[profile.story.rank_tier] * ngMult) * profile.story.sessions));
    const sponsor = passive.sponsor_contract_p4;
    if (!sponsor) throw new Error('passive.sponsor_contract_p4: configuration is required');
    income.push(moneyLine('passive.sponsor', midpoint({ min: sponsor.daily_income_min, max: sponsor.daily_income_max }) * DAYS_PER_WEEK * profile.passive.sponsor_contracts));
    const coach = passive.substitute_coach_y6;
    if (!coach) throw new Error('passive.substitute_coach_y6: configuration is required');
    const coachTier = lecture.audience_tiers.find((entry) => entry.id === coach.tier_cap);
    if (!coachTier) throw new Error('passive.substitute_coach_y6.tier_cap: missing lecture tier');
    income.push(moneyLine('passive.coach', coachTier.base_money * coach.player_share_ratio * coach.passive_lectures_per_week * profile.passive.substitute_coaches));
    const incomeTotal = income.reduce((sum, line) => sum + line.amount, 0);
    const expenseTotal = expenses.reduce((sum, line) => sum + line.amount, 0);
    const ratio = expenseTotal === 0 ? null : incomeTotal / expenseTotal;
    return { id: profile.id, label: profile.label, income, expenses, incomeTotal, expenseTotal, net: incomeTotal - expenseTotal, ratio };
  });
  const targetProfile = profiles.find((profile) => profile.id === simulation.target_profile)!;
  return { profiles, target: { profileId: simulation.target_profile, min: targetRange[0], max: targetRange[1], actual: targetProfile.ratio, pass: targetProfile.ratio != null && targetProfile.ratio >= targetRange[0] && targetProfile.ratio <= targetRange[1] } };
}
