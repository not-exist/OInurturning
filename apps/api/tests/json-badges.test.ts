import { describe, expect, it } from 'vitest';
import { readBadgeList } from '../src/lib/json.js';

/**
 * T6：User.badges Json 列的元素级校验收口（读/写共用同一契约）。
 * 口径与 story/service.ts 既有读侧逐字一致：非数组 → []；数组 → 仅保留字符串元素；
 * 返回新数组，调用方（RMW 写回侧）可安全 push 后整体写回，落库值恒为 string[]。
 */
describe('readBadgeList', () => {
  it('keeps string elements in order', () => {
    expect(readBadgeList(['onboarding-done', 'rookie-done'])).toEqual([
      'onboarding-done',
      'rookie-done',
    ]);
  });

  it('drops non-string elements (number/null/bool/object)', () => {
    expect(readBadgeList(['kept', 42, null, true, { junk: 1 }, 'clean'])).toEqual([
      'kept',
      'clean',
    ]);
  });

  it('maps non-array values to an empty list', () => {
    expect(readBadgeList(null)).toEqual([]);
    expect(readBadgeList(undefined)).toEqual([]);
    expect(readBadgeList('onboarding-done')).toEqual([]);
    expect(readBadgeList(42)).toEqual([]);
    expect(readBadgeList({ badge: 'x' })).toEqual([]);
  });

  it('maps an empty array to an empty list', () => {
    expect(readBadgeList([])).toEqual([]);
  });

  it('returns a fresh array the caller can mutate without touching the source', () => {
    const source = ['a', 'b'];
    const badges = readBadgeList(source);
    expect(badges).not.toBe(source);
    badges.push('c');
    expect(source).toEqual(['a', 'b']);
  });
});
