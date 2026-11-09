import { describe, expect, it } from 'vitest';
import { amountFromFields, centsToInput, formatCents, parseDollars } from './money';

describe('parseDollars', () => {
  it.each([
    ['12', 1200],
    ['12.3', 1230],
    ['12.34', 1234],
    ['12.', 1200],
    ['.1', 10],
    ['.05', 5],
    ['0.07', 7],
    ['1,234.56', 123456],
    ['1,234,567', 123456700],
    ['$1,234.56', 123456],
    ['-5', -500],
    ['-$5.25', -525],
    ['  7.5  ', 750],
    ['0', 0],
    ['-0', 0],
    ['19.99', 1999],
    ['1.15', 115],
    ['4.35', 435],
    ['9999999999.99', 999999999999],
  ])('parses %s', (input, expected) => {
    expect(Object.is(parseDollars(input), expected)).toBe(true);
  });

  it.each(['', '.', '-', '$', 'abc', '1.234', '1.999', '1,23', '12,34.5', '1.2.3', '12345678901'])(
    'rejects "%s"',
    (input) => {
      expect(parseDollars(input)).toBeNull();
    },
  );
});

describe('formatCents', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [123, '$1.23'],
    [100000, '$1,000.00'],
    [123456789, '$1,234,567.89'],
    [-525, '-$5.25'],
    [999999999999, '$9,999,999,999.99'],
  ])('formats %d', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});

describe('centsToInput', () => {
  it('formats the size of the amount without symbols', () => {
    expect(centsToInput(-123456)).toBe('1234.56');
    expect(centsToInput(5)).toBe('0.05');
  });
});

describe('amountFromFields', () => {
  it('makes outflows negative and inflows positive', () => {
    expect(amountFromFields('25.50', '')).toEqual({ cents: -2550 });
    expect(amountFromFields('', '100')).toEqual({ cents: 10000 });
  });

  it.each([
    ['', ''],
    ['  ', ''],
    ['1', '2'],
    ['abc', ''],
    ['-5', ''],
    ['', '1.234'],
    ['0', ''],
  ])('reports an error for outflow "%s" and inflow "%s"', (outflow, inflow) => {
    expect(amountFromFields(outflow, inflow).error).toEqual(expect.any(String));
  });
});
