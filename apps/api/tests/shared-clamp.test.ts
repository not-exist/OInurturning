import { describe, expect, it } from 'vitest';
import { clamp, clampInt } from '@oinur/shared';

describe('clamp', () => {
  it('keeps in-range values unchanged', () => {
    expect(clamp(3.5, 0, 10)).toBe(3.5);
    expect(clamp(-7.25, -10, 10)).toBe(-7.25);
  });

  it('clamps values below the minimum', () => {
    expect(clamp(-0.5, 0, 10)).toBe(0);
    expect(clamp(-99, -10, 10)).toBe(-10);
  });

  it('clamps values above the maximum', () => {
    expect(clamp(10.5, 0, 10)).toBe(10);
    expect(clamp(99, -10, 10)).toBe(10);
  });

  it('keeps boundary values equal to the bounds', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
    expect(clamp(-10, -10, 10)).toBe(-10);
  });

  it('propagates NaN (dominant form has no NaN guard)', () => {
    expect(clamp(Number.NaN, 0, 10)).toBeNaN();
  });
});

describe('clampInt', () => {
  it('truncates fractional values toward zero before clamping', () => {
    expect(clampInt(3.7, 0, 5)).toBe(3);
    expect(clampInt(-3.7, -10, 10)).toBe(-3);
  });

  it('keeps in-range integers unchanged', () => {
    expect(clampInt(2, 0, 5)).toBe(2);
    expect(clampInt(-4, -10, 10)).toBe(-4);
  });

  it('clamps values below the minimum', () => {
    expect(clampInt(-1, 0, 5)).toBe(0);
    expect(clampInt(-99, -10, 10)).toBe(-10);
  });

  it('clamps values above the maximum', () => {
    expect(clampInt(9, 0, 5)).toBe(5);
    expect(clampInt(99, -10, 10)).toBe(10);
  });

  it('keeps boundary values equal to the bounds', () => {
    expect(clampInt(0, 0, 5)).toBe(0);
    expect(clampInt(5, 0, 5)).toBe(5);
  });

  it('maps non-finite input to the minimum (tutorial/routing.ts guard preserved)', () => {
    expect(clampInt(Number.NaN, 0, 5)).toBe(0);
    expect(clampInt(Number.POSITIVE_INFINITY, 0, 5)).toBe(0);
    expect(clampInt(Number.NEGATIVE_INFINITY, 0, 5)).toBe(0);
  });
});
