import { afterEach, describe, expect, it, vi } from 'vitest';
import { shortDate, today } from './dates';
import { currentMonth } from './months';

afterEach(() => {
  vi.useRealTimers();
});

describe('today and currentMonth', () => {
  it('use the browser’s local date, even late in the evening', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 23, 59));

    expect(today()).toBe('2026-01-05');
    expect(currentMonth()).toBe('2026-01');
  });

  it('pad single-digit months and days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 9, 8, 0));

    expect(today()).toBe('2026-09-09');
  });
});

describe('shortDate', () => {
  it('leaves out this year, and shows any other', () => {
    expect(shortDate('2026-11-08', '2026-11-21')).toBe('Nov 8');
    expect(shortDate('2026-01-31', '2026-11-21')).toBe('Jan 31');
    expect(shortDate('2025-12-31', '2026-01-02')).toBe('Dec 31, 2025');
  });
});
