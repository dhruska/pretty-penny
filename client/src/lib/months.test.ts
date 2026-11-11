import { describe, expect, it } from 'vitest';
import { formatMonth, isMonth, monthRange, shiftMonth } from './months';

describe('shiftMonth', () => {
  it.each([
    ['2026-03', 1, '2026-04'],
    ['2026-03', -1, '2026-02'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-06', 18, '2027-12'],
  ])('shifts %s by %d', (month, delta, expected) => {
    expect(shiftMonth(month, delta)).toBe(expected);
  });
});

describe('monthRange', () => {
  it('ends on the last day of the month, including leap years', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('formatMonth', () => {
  it('names the month and year', () => {
    expect(formatMonth('2026-01')).toBe('January 2026');
    expect(formatMonth('2026-12')).toBe('December 2026');
  });
});

describe('isMonth', () => {
  it('accepts only valid months', () => {
    expect(isMonth('2026-11')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth('November')).toBe(false);
    expect(isMonth(null)).toBe(false);
  });
});
