/**
 * 数值钳制工具（R4 重复收口）：
 * 此前仓库内有 12 份命名 clamp 副本 + 26 处内联 Math.min/max 幂等式，统一收口到这里。
 */

/** 将 v 钳制到 [lo, hi]（与主导实现逐字一致：Math.min(hi, Math.max(lo, v))，NaN 原样穿透） */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 整数变体（原 tutorial/routing.ts 语义，逐字保留）：
 * 非有限值（含 NaN/±Infinity）返回 min；否则先向零截断再钳制。
 */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return clamp(Math.trunc(value), min, max);
}
