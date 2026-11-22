import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  defaultImportFrom,
  importAmountCents,
  importDate,
  importPayee,
  matchImports,
} from './matching.js';

const item = (id: number, date: string, amountCents = -4250) => ({ id, date, amountCents });

describe('dates', () => {
  it('count and move days across months and years', () => {
    expect(daysBetween('2026-11-28', '2026-12-03')).toBe(5);
    expect(daysBetween('2026-12-03', '2026-11-28')).toBe(-5);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('reading Plaid’s transactions', () => {
  it('uses the purchase date when the bank gives one', () => {
    expect(importDate({ date: '2026-11-12', authorized_date: '2026-11-10' })).toBe('2026-11-10');
    expect(importDate({ date: '2026-11-12', authorized_date: null })).toBe('2026-11-12');
  });

  it('turns money out negative and money in positive, in whole cents', () => {
    expect(importAmountCents({ amount: 42.5 })).toBe(-4250);
    expect(importAmountCents({ amount: -2500 })).toBe(250000);
    expect(importAmountCents({ amount: 0.1 + 0.2 })).toBe(-30);
  });

  it('prefers the merchant name, otherwise the bank’s text', () => {
    expect(importPayee({ name: 'GREENLEAF #22', merchantName: 'Greenleaf Grocery' })).toBe(
      'Greenleaf Grocery',
    );
    expect(importPayee({ name: '  PAYROLL DEPOSIT ', merchantName: null })).toBe('PAYROLL DEPOSIT');
    expect(importPayee({ name: 'X', merchantName: '  ' })).toBe('X');
    expect(importPayee({ name: 'Y'.repeat(300), merchantName: null })).toHaveLength(200);
  });
});

describe('matching imports with what you entered', () => {
  it('needs the same amount and dates within 10 days', () => {
    const entered = [item(1, '2026-11-08'), item(2, '2026-11-08', -4251), item(3, '2026-10-20')];
    expect(matchImports([item(10, '2026-11-18')], entered)).toEqual(new Map([[10, 1]]));
    expect(matchImports([item(10, '2026-11-19')], entered)).toEqual(new Map());
    expect(matchImports([item(10, '2026-10-29')], entered)).toEqual(new Map([[10, 3]]));
  });

  it('chooses the closest date, then the oldest', () => {
    const entered = [item(1, '2026-11-01'), item(2, '2026-11-05'), item(3, '2026-11-07')];
    expect(matchImports([item(10, '2026-11-06')], entered)).toEqual(new Map([[10, 2]]));
    // Days 5 and 7 are both one day from the 6th; the older wins, then the lower id.
    expect(
      matchImports([item(10, '2026-11-06')], [item(3, '2026-11-07'), item(2, '2026-11-05')]),
    ).toEqual(new Map([[10, 2]]));
    expect(
      matchImports([item(10, '2026-11-06')], [item(5, '2026-11-06'), item(4, '2026-11-06')]),
    ).toEqual(new Map([[10, 4]]));
  });

  it('matches one to one, oldest imports first', () => {
    const entered = [item(1, '2026-11-05'), item(2, '2026-11-20')];
    const imports = [item(11, '2026-11-12'), item(10, '2026-11-04'), item(12, '2026-11-13')];
    expect(matchImports(imports, entered)).toEqual(
      new Map([
        [10, 1],
        [11, 2],
      ]),
    );
  });
});

describe('where importing starts', () => {
  it('is 3 days before the newest reconciled transaction, as in YNAB', () => {
    expect(defaultImportFrom('2026-11-10', '2026-11-14', '2026-11-15')).toBe('2026-11-07');
  });

  it('otherwise 3 days before the newest transaction, or today for an empty account', () => {
    expect(defaultImportFrom(null, '2026-11-14', '2026-11-15')).toBe('2026-11-11');
    expect(defaultImportFrom(null, null, '2026-11-15')).toBe('2026-11-15');
  });
});
