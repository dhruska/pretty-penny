import { describe, expect, it } from 'vitest';
import { localToday, occurrence, type Frequency } from './schedule.js';

const first = (frequency: Frequency, start: string, count: number) =>
  Array.from({ length: count }, (_, index) => occurrence(start, frequency, index));

describe('occurrence', () => {
  it.each<[Frequency, string[]]>([
    ['daily', ['2026-03-30', '2026-03-31', '2026-04-01']],
    ['weekly', ['2026-03-30', '2026-04-06', '2026-04-13']],
    ['everyOtherWeek', ['2026-03-30', '2026-04-13', '2026-04-27']],
    ['every4Weeks', ['2026-03-30', '2026-04-27', '2026-05-25']],
    ['monthly', ['2026-03-30', '2026-04-30', '2026-05-30']],
    ['everyOtherMonth', ['2026-03-30', '2026-05-30', '2026-07-30']],
    ['every3Months', ['2026-03-30', '2026-06-30', '2026-09-30']],
    ['every4Months', ['2026-03-30', '2026-07-30', '2026-11-30']],
    ['twiceAYear', ['2026-03-30', '2026-09-30', '2027-03-30']],
    ['yearly', ['2026-03-30', '2027-03-30', '2028-03-30']],
    ['everyOtherYear', ['2026-03-30', '2028-03-30', '2030-03-30']],
  ])('steps %s from the first date', (frequency, expected) => {
    expect(first(frequency, '2026-03-30', 3)).toEqual(expected);
  });

  it('happens once for a one-time schedule', () => {
    expect(first('never', '2026-03-30', 2)).toEqual(['2026-03-30', null]);
  });

  it('clamps month-end dates to shorter months and returns to the original day', () => {
    expect(first('monthly', '2026-01-31', 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('handles leap days', () => {
    expect(first('yearly', '2028-02-29', 3)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28']);
    expect(occurrence('2028-02-29', 'yearly', 4)).toBe('2032-02-29');
  });

  it('places twice-a-month occurrences on the first date and 15 days later', () => {
    expect(first('twiceAMonth', '2026-01-01', 5)).toEqual([
      '2026-01-01',
      '2026-01-16',
      '2026-02-01',
      '2026-02-16',
      '2026-03-01',
    ]);
    expect(first('twiceAMonth', '2026-01-20', 4)).toEqual([
      '2026-01-20',
      '2026-02-04',
      '2026-02-20',
      '2026-03-07',
    ]);
  });

  it('crosses year boundaries and runs far ahead without drifting', () => {
    expect(occurrence('2026-12-15', 'monthly', 1)).toBe('2027-01-15');
    expect(occurrence('2026-01-31', 'monthly', 120)).toBe('2036-01-31');
    expect(occurrence('2026-01-05', 'weekly', 520)).toBe('2035-12-24');
  });

  it('has no occurrence before the first', () => {
    expect(occurrence('2026-01-01', 'monthly', -1)).toBeNull();
  });
});

describe('localToday', () => {
  it('formats the local date', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
