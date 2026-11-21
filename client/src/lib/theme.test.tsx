import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDark, storedTheme, THEME_KEY, useTheme } from './theme';

let deviceDark = false;
const listeners = new Set<() => void>();

beforeEach(() => {
  deviceDark = false;
  listeners.clear();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return deviceDark;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
});

afterEach(() => vi.unstubAllGlobals());

const dark = () => document.documentElement.classList.contains('dark');

describe('theme', () => {
  it('shows dark for Dark, or for System on a device set to dark', () => {
    expect(isDark('dark', false)).toBe(true);
    expect(isDark('light', true)).toBe(false);
    expect(isDark('system', true)).toBe(true);
    expect(isDark('system', false)).toBe(false);
  });

  it('remembers a choice, and treats anything else as System', () => {
    expect(storedTheme()).toBe('system');
    window.localStorage.setItem(THEME_KEY, 'dark');
    expect(storedTheme()).toBe('dark');
    window.localStorage.setItem(THEME_KEY, 'purple');
    expect(storedTheme()).toBe('system');
  });

  it('falls back to System when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(storedTheme()).toBe('system');
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]('dark'));
    expect(dark()).toBe(true);
    vi.restoreAllMocks();
  });

  it('applies and remembers choices, and follows the device live under System', () => {
    const { result, unmount } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('system');
    expect(dark()).toBe(false);

    // The device switching to dark is followed right away.
    deviceDark = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(dark()).toBe(true);

    act(() => result.current[1]('light'));
    expect(dark()).toBe(false);
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light');
    expect(listeners.size).toBe(0);

    act(() => result.current[1]('system'));
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    expect(dark()).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
