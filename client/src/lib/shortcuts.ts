import { useEffect, useRef } from 'react';

/** Every shortcut, for the list `?` opens. */
export const SHORTCUTS = [
  { keys: 'n', description: 'Add a transaction (on an account)' },
  { keys: '← →', description: 'Previous or next month (on the budget)' },
  { keys: 't', description: 'This month (on the budget)' },
  { keys: '/', description: 'Search or filter transactions' },
  { keys: '?', description: 'Show these shortcuts' },
  { keys: 'Esc', description: 'Close a dialog or menu' },
];

/** Whether a key press is someone typing, or holding a modifier, rather than a shortcut. */
export function isShortcutEvent(
  event: Pick<KeyboardEvent, 'target' | 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented'>,
) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return false;
  const target = event.target as HTMLElement | null;
  if (!target || !('tagName' in target)) return true;
  if (target.isContentEditable) return false;
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Runs a handler when one of its keys is pressed, unless someone's typing or a dialog is open. */
export function useShortcuts(handlers: Record<string, () => void>) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isShortcutEvent(event)) return;
      // Shortcuts are for the page itself, not whatever dialog is open on top of it.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const handler = latest.current[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
