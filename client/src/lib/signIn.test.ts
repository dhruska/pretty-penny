import { describe, expect, it } from 'vitest';
import { safeNext, signInPath } from './signIn';

describe('signing in', () => {
  it('returns only to pages in this app', () => {
    expect(safeNext('/reports?range=year')).toBe('/reports?range=year');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });

  it('remembers the page to return to', () => {
    expect(signInPath('/accounts/3?x=1')).toBe('/login?next=%2Faccounts%2F3%3Fx%3D1');
    expect(signInPath('/')).toBe('/login');
    expect(signInPath('/login?next=%2Freports')).toBe('/login');
  });
});
