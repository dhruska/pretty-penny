import { describe, expect, it } from 'vitest';
import { defaultCategory } from './payee-defaults.js';

const GROCERIES = 1;
const DINING = 2;
const GIFTS = 3;

describe('defaultCategory', () => {
  it('is null with no categorized history', () => {
    expect(defaultCategory([])).toBeNull();
  });

  it('starts as the first category used', () => {
    expect(defaultCategory([GROCERIES])).toBe(GROCERIES);
  });

  it('ignores a single different category', () => {
    expect(defaultCategory([GROCERIES, GROCERIES, DINING])).toBe(GROCERIES);
  });

  it('changes when 2 of the 3 most recent agree on a different category', () => {
    expect(defaultCategory([GROCERIES, DINING, DINING])).toBe(DINING);
    expect(defaultCategory([GROCERIES, DINING, GROCERIES, DINING])).toBe(DINING);
    expect(defaultCategory([GROCERIES, DINING, GROCERIES])).toBe(GROCERIES);
  });

  it('does not change when the recent three all differ', () => {
    expect(defaultCategory([GROCERIES, DINING, GIFTS])).toBe(GROCERIES);
  });

  it('only counts the most recent three', () => {
    expect(defaultCategory([DINING, DINING, GROCERIES, GIFTS, GROCERIES])).toBe(GROCERIES);
  });
});
