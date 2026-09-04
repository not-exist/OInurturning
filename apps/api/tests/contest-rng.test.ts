import { describe, expect, it } from 'vitest';
import { createRandomStream, deriveSeed, RNG_VERSION } from '../src/modules/contest/engine/rng.js';

describe('contest RNG', () => {
  it('uses the stable FNV-1a 32-bit hash for seed derivation', () => {
    expect(deriveSeed('hello')).toBe(0x4f9f2cab);
    expect(deriveSeed('user', 42, 'story:1')).toBe(deriveSeed('user', 42, 'story:1'));
  });

  it('replays identical streams from identical seeds and labels', () => {
    const first = createRandomStream(0x12345678, 'judge');
    const second = createRandomStream(0x12345678, 'judge');

    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
    expect(RNG_VERSION).toBe('mulberry32-v1');
  });

  it('keeps labeled streams independent when another stream is consumed', () => {
    const noise = createRandomStream(73, 'noise');
    const judge = createRandomStream(73, 'judge');
    const untouchedNoise = createRandomStream(73, 'noise');

    const firstNoise = noise();
    judge();
    judge();
    const secondNoise = noise();

    expect([firstNoise, secondNoise]).toEqual([untouchedNoise(), untouchedNoise()]);
    expect(firstNoise).not.toBe(createRandomStream(73, 'judge')());
  });
});
