import { describe, expect, it } from 'vitest';
import { spreadRemainder } from './splits';

const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0);

describe('spreadRemainder', () => {
  it('spreads in proportion to each line', () => {
    expect(spreadRemainder([-60_00, -40_00], -10_00)).toEqual([-66_00, -44_00]);
  });

  it('gives a rounding cent to the largest line and keeps the total exact', () => {
    const result = spreadRemainder([-1_00, -1_00, -2_00], -1);

    expect(result).toEqual([-1_00, -1_00, -2_01]);
    expect(sum(result)).toBe(-4_01);
  });

  it('keeps the total exact for awkward amounts', () => {
    const amounts = [-33_33, -33_33, -33_34];
    const result = spreadRemainder(amounts, -7_77);

    expect(sum(result)).toBe(sum(amounts) - 7_77);
  });

  it('can take money back out of the lines', () => {
    expect(spreadRemainder([-66_00, -44_00], 10_00)).toEqual([-60_00, -40_00]);
  });

  it('weighs lines by size when they mix money out and in', () => {
    expect(spreadRemainder([-75_00, 25_00], -10_00)).toEqual([-82_50, 22_50]);
  });

  it('puts everything on the first line when the lines are all zero', () => {
    expect(spreadRemainder([0, 0], -5_00)).toEqual([-5_00, 0]);
  });

  it('changes nothing when there is nothing remaining', () => {
    expect(spreadRemainder([-60_00, -40_00], 0)).toEqual([-60_00, -40_00]);
  });
});
