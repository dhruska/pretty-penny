import { describe, expect, it } from 'vitest';
import { flagColorVar, flagLabel } from './flags';

describe('flags', () => {
  it('labels a flag by its name, or its color when unnamed or blank', () => {
    expect(flagLabel('green', [{ color: 'green', name: 'Gifts' }])).toBe('Gifts');
    expect(flagLabel('green', [{ color: 'green', name: '  ' }])).toBe('Green');
    expect(flagLabel('yellow', [])).toBe('Yellow');
  });

  it('uses the color tokens from the stylesheet', () => {
    expect(flagColorVar('orange')).toBe('var(--flag-orange)');
  });
});
