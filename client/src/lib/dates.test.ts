import { afterEach, describe, expect, it, vi } from 'vitest';
import { today } from './dates';
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
