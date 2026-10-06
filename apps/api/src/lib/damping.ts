/**
 * 收益递减阻尼因子（student.md §4.1：cap=100、k=2）：
 * damping(cur) = (1 − cur/100)²，cur ≥ 100 计 0（已到上限即无收益）。
 *
 * 与无守卫写法 Math.max(0, 1 − cur/100)² 在全体输入（含 NaN/±∞）上逐位等价：
 * cur ≥ 100 时 1 − cur/100 ≤ 0，两侧同为 0；cur < 100 时该值为正，Math.max 为空操作。
 * 讲课（academy）、训练（training）、剧情实战成长（story）与经济推演（economy/progression）
 * 共用此单点实现，禁止再手写 (1 − cur/100)² 字面量。
 */
export function damping(cur: number): number {
  if (cur >= 100) return 0;
  return (1 - cur / 100) ** 2;
}
