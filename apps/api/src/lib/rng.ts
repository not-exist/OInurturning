/**
 * mulberry32 种子随机：确定性可复现（TECH-DESIGN P6）。
 * 同 seed 必得同序列；返回 [0, 1) 均匀分布。M1 先建，Task 3 起用。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
