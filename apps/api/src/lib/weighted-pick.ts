/**
 * 加权抽取（cumulative roll）：roll = rng() * Σweight，依序扣减，首次 < 0 即中，
 * 浮点兜底取末项。空池或 Σweight 非有限（NaN/±∞）或 ≤ 0 属服务端配置腐坏，抛普通 Error
 * （errorHandler 将非 ApiError 映射为 500 INTERNAL），调用方不可达时不应捕获。
 */
export function weightedPick<T>(
  entries: readonly { value: T; weight: number }[],
  rng: () => number,
): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('weighted pool is empty');

  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return entries[entries.length - 1]!.value;
}
