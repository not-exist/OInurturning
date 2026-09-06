import type { EconomyConfig, ItemDef, StageConfig } from '@oinur/shared';

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

export function simulateEconomy(input: SimulationInput): EconomySimulationReport {
  const economy = input.economy as any;
  const simulation = economy.simulation;
  if (!simulation) throw new Error('economy.simulation is required');
  const training = economy.training;
  const recruitment = economy.recruitment;
  const lecture = economy.lecture;
  const contest = economy.contest ?? {};
  const adventure = economy.adventure;
  const passive = economy.passive;
  const rankCoeffs = contest.rank_coeffs ?? {};
  const ngFormula = String(contest.ngplus_money_multiplier?.formula ?? '');
  const ngMatch = ngFormula.match(/1\s*\+\s*([0-9]+(?:\.[0-9]+)?)\s*\*\s*k/);
  if (!ngMatch) throw new Error('contest.ngplus_money_multiplier.formula: expected "1 + coefficient * k"');
  const ngCoeff = Number(ngMatch[1]);
  for (const rank of ['champion', 'runner_up', 'third_to_eighth']) {
    if (!Number.isFinite(rankCoeffs[rank])) throw new Error(`contest.rank_coeffs.${rank}: missing or invalid coefficient`);
  }
  const targetRange = economy.meta?.calibration_profile?.target_income_expense_ratio;
  if (!Array.isArray(targetRange) || targetRange.length !== 2 || !targetRange.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('meta.calibration_profile.target_income_expense_ratio: expected finite [min, max]');
  }
  const order = ['beginner', 'mid', 'late'] as const;
  const profiles: ProfileSimulation[] = order.map((id) => {
    const profile = simulation.profiles.find((candidate: any) => candidate.id === id);
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

    const tier = lecture?.audience_tiers?.find((entry: any) => entry.id === profile.lectures.tier);
    if (!tier) throw new Error(`simulation.profiles.${profile.id}.lectures.tier: missing lecture tier ${profile.lectures.tier}`);
    const repCurve = lecture.reputation_pay_curve;
    const repMult = Math.max(repCurve.min_mult, Math.min(repCurve.max_mult, 1 + profile.reputation / repCurve.rep_divisor));
    const overflow = Math.min(lecture.overflow_bonus.overflow_cap_pct, Math.max(0, Math.floor(Math.max(0, profile.ability - tier.threshold) / lecture.overflow_bonus.overflow_step) * lecture.overflow_bonus.overflow_pct));
    income.push(moneyLine('lectures', round(tier.base_money * repMult * (1 + overflow)) * profile.lectures.sessions));
    const ranges = adventure.money_ranges_by_rarity as Record<string, { min: number; max: number }>;
    const values = Object.fromEntries(Object.entries(ranges).map(([key, range]) => [key, midpoint(range)]));
    income.push(moneyLine('adventures', weightedAverage(profile.adventures.rarity_mix, values) * profile.adventures.sessions));
    const stage = input.stages[profile.story.stage_key];
    if (!stage) throw new Error(`simulation.profiles.${profile.id}.story.stage_key: missing stage ${profile.story.stage_key}`);
    const chapterStage = Object.values(input.stages).find((candidate) => candidate.chapter === stage.chapter && candidate.stage_index === 1) ?? stage;
    const ngMult = 1 + ngCoeff * profile.story.ng_level;
    income.push(moneyLine('story', (chapterStage.first_clear.money * (rankCoeffs[profile.story.rank_tier] ?? 0) * ngMult) * profile.story.sessions));
    if (passive) {
      const sponsor = passive.sponsor_contract_p4;
      income.push(moneyLine('passive.sponsor', midpoint({ min: sponsor.daily_income_min, max: sponsor.daily_income_max }) * sponsor.contract_days * profile.passive.sponsor_contracts));
      const coachTier = lecture.audience_tiers.find((entry: any) => entry.id === passive.substitute_coach_y6.tier_cap);
      income.push(moneyLine('passive.coach', (coachTier?.base_money ?? 0) * passive.substitute_coach_y6.player_share_ratio * passive.substitute_coach_y6.passive_lectures_per_week * profile.passive.substitute_coaches));
    }
    const incomeTotal = income.reduce((sum, line) => sum + line.amount, 0);
    const expenseTotal = expenses.reduce((sum, line) => sum + line.amount, 0);
    const ratio = expenseTotal === 0 ? null : incomeTotal / expenseTotal;
    return { id: profile.id, label: profile.label, income, expenses, incomeTotal, expenseTotal, net: incomeTotal - expenseTotal, ratio };
  });
  const targetProfile = profiles.find((profile) => profile.id === simulation.target_profile)!;
  return { profiles, target: { profileId: simulation.target_profile, min: targetRange[0], max: targetRange[1], actual: targetProfile.ratio, pass: targetProfile.ratio != null && targetProfile.ratio >= targetRange[0] && targetProfile.ratio <= targetRange[1] } };
}
