import { describe, expect, it } from 'vitest';
import { isShortcutEvent } from './shortcuts';

const press = (target: HTMLElement | null, modifiers: Partial<KeyboardEvent> = {}) => ({
  target,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  defaultPrevented: false,
  ...modifiers,
});

describe('shortcuts', () => {
  it('apply on the page, but not while typing in a field', () => {
    expect(isShortcutEvent(press(document.body))).toBe(true);
    expect(isShortcutEvent(press(document.createElement('button')))).toBe(true);
    expect(isShortcutEvent(press(null))).toBe(true);
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isShortcutEvent(press(document.createElement(tag))), tag).toBe(false);
    }
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isShortcutEvent(press(editable))).toBe(false);
  });

  it('leave keys with Cmd, Ctrl or Option, or already handled, to the browser', () => {
    expect(isShortcutEvent(press(document.body, { metaKey: true }))).toBe(false);
    expect(isShortcutEvent(press(document.body, { ctrlKey: true }))).toBe(false);
    expect(isShortcutEvent(press(document.body, { altKey: true }))).toBe(false);
    expect(isShortcutEvent(press(document.body, { defaultPrevented: true }))).toBe(false);
  });
});
