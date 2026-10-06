import { clamp } from '@oinur/shared';
import { mulberry32 } from '../../../lib/rng.js';
import type { RandomSource } from './models.js';

export const RNG_VERSION = 'mulberry32-v1' as const;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Stable FNV-1a over UTF-16 code units, returned as an unsigned 32-bit value. */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

/** Stable FNV-1a over UTF-16 code units, returned as an unsigned 32-bit seed. */
export function deriveSeed(...parts: (string | number)[]): number {
  return fnv1a32(parts.map(String).join(':'));
}

/** Derive the seed that backs one documented labeled substream. */
export function deriveStreamSeed(baseSeed: number, label: string): number {
  const hexadecimalSeed = (baseSeed >>> 0).toString(16);
  return deriveSeed(hexadecimalSeed, label);
}

/** A fresh deterministic substream; consuming another label cannot advance it. */
export function createRandomStream(baseSeed: number, label: string): RandomSource {
  return mulberry32(deriveStreamSeed(baseSeed, label));
}

/**
 * Box–Muller 标准正态采样（npc.ts 与 solve.ts 共用单点实现）：
 * 固定消耗 rng 两次（u1 → u2），返回 N(0,1) 样本。
 * u1 钳到 [Number.EPSILON, 1 − Number.EPSILON]（rng()=0 时 log(0) = −Inf，钳下限保证有限），
 * u2 钳到 [0, 1 − Number.EPSILON]；非有限值按 0.5 兜底（mulberry32 输出恒为有限 [0,1)，兜底仅防御性）。
 * mulberry32 输出粒度为 k/2³²，最大值 1−2⁻³² < 1−2⁻⁵²，故上钳永不生效（仅对非 mulberry32 来源兜底）。
 */
export function standardNormal(rng: () => number): number {
  const firstRaw = rng();
  const secondRaw = rng();
  const first = clamp(Number.isFinite(firstRaw) ? firstRaw : 0.5, Number.EPSILON, 1 - Number.EPSILON);
  const second = clamp(Number.isFinite(secondRaw) ? secondRaw : 0.5, 0, 1 - Number.EPSILON);
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}
