import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/lib/rng.js';
import { weightedPick } from '../src/lib/weighted-pick.js';

describe('weightedPick', () => {
  it('throws on empty pool', () => {
    expect(() => weightedPick([], () => 0.5)).toThrow(/weighted pool is empty/);
  });

  it('throws when total weight is zero or negative', () => {
    expect(() =>
      weightedPick(
        [
          { value: 'a', weight: 0 },
          { value: 'b', weight: 0 },
        ],
        () => 0.5,
      ),
    ).toThrow(/weighted pool is empty/);
    expect(() =>
      weightedPick(
        [
          { value: 'a', weight: -1 },
          { value: 'b', weight: -2 },
        ],
        () => 0.5,
      ),
    ).toThrow(/weighted pool is empty/);
  });

  it('throws when a weight is NaN or infinite (non-finite total)', () => {
    expect(() =>
      weightedPick(
        [
          { value: 'a', weight: Number.NaN },
          { value: 'b', weight: 1 },
        ],
        () => 0.5,
      ),
    ).toThrow(/weighted pool is empty/);
    expect(() => weightedPick([{ value: 'a', weight: Number.POSITIVE_INFINITY }], () => 0.5)).toThrow(
      /weighted pool is empty/,
    );
  });

  it('returns the only entry and consumes exactly one rng sample', () => {
    let calls = 0;
    const rng = () => {
      calls += 1;
      return 0.99;
    };
    expect(weightedPick([{ value: 'only', weight: 5 }], rng)).toBe('only');
    expect(calls).toBe(1);
  });

  it('consumes exactly one rng sample for a multi-entry pool', () => {
    let calls = 0;
    const rng = () => {
      calls += 1;
      return 0.25;
    };
    expect(
      weightedPick(
        [
          { value: 'a', weight: 7 },
          { value: 'b', weight: 3 },
        ],
        rng,
      ),
    ).toBe('a');
    expect(calls).toBe(1);
  });

  it('skips zero-weight entries without rejecting the pool', () => {
    expect(
      weightedPick(
        [
          { value: 'ghost', weight: 0 },
          { value: 'real', weight: 1 },
        ],
        () => 0.99,
      ),
    ).toBe('real');
  });

  it('walks cumulative order with strict roll < 0 and falls back to the last entry', () => {
    // roll = 0.5 * 1 = 0.5；扣 a(0.5) 后 = 0，不满足 < 0；扣 b(0.5) 后 = 0 → 兜底末项
    const pick = (roll: number) =>
      weightedPick(
        [
          { value: 'a', weight: 0.5 },
          { value: 'b', weight: 0.5 },
        ],
        () => roll,
      );
    expect(pick(0.5)).toBe('b');
    expect(pick(0.4999)).toBe('a');
  });

  it('matches seeded frequencies (mulberry32, 70/30 pool)', () => {
    const rng = mulberry32(42);
    const entries = [
      { value: 'a', weight: 70 },
      { value: 'b', weight: 30 },
    ] as const;
    let a = 0;
    const draws = 20_000;
    for (let i = 0; i < draws; i++) {
      if (weightedPick(entries, rng) === 'a') a += 1;
    }
    const freq = a / draws;
    expect(freq).toBeGreaterThan(0.68);
    expect(freq).toBeLessThan(0.72);
  });
});
