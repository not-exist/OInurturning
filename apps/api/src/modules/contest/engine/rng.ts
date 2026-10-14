import { mulberry32 } from '../../../lib/rng.js';
import type { RandomSource } from './models.js';

export const RNG_VERSION = 'mulberry32-v1' as const;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Stable FNV-1a over UTF-16 code units, returned as an unsigned 32-bit seed. */
export function deriveSeed(...parts: (string | number)[]): number {
  const input = parts.map(String).join(':');
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
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
