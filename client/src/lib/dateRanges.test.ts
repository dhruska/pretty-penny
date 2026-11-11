import { describe, expect, it } from 'vitest';
import { presetRange, rangeParams } from './dateRanges';

describe('presetRange', () => {
  const now = '2026-11-10';

  it.each([
    ['thisMonth', { from: '2026-11-01', to: now }],
    ['last3Months', { from: '2026-09-01', to: now }],
    ['last6Months', { from: '2026-06-01', to: now }],
    ['thisYear', { from: '2026-01-01', to: now }],
    ['lastYear', { from: '2025-01-01', to: '2025-12-31' }],
    ['allTime', { from: undefined, to: now }],
  ] as const)('covers %s', (preset, expected) => {
    expect(presetRange(preset, now)).toEqual(expected);
  });

  it('crosses into the previous year when needed', () => {
    expect(presetRange('last3Months', '2026-01-15')).toEqual({
      from: '2025-11-01',
      to: '2026-01-15',
    });
  });
});

describe('rangeParams', () => {
  it('leaves out unset values', () => {
    expect(
      rangeParams(
        { from: undefined, to: '2026-11-10' },
        { groupBy: 'payee', categoryId: '' },
      ).toString(),
    ).toBe('to=2026-11-10&groupBy=payee');
  });
});
