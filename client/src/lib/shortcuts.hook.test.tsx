import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useShortcuts } from './shortcuts';

function Page({ handlers }: { handlers: Record<string, () => void> }) {
  useShortcuts(handlers);
  return <input aria-label="Field" />;
}

const press = (key: string, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

describe('useShortcuts', () => {
  it('runs the handler for a key, using the latest handlers, and stops when unmounted', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Page handlers={{ n: first }} />);
    press('n');
    expect(first).toHaveBeenCalledTimes(1);

    view.rerender(<Page handlers={{ n: second }} />);
    press('n');
    expect(second).toHaveBeenCalledTimes(1);
    press('x');

    view.unmount();
    press('n');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('ignores keys typed in a field, or while a dialog is open', () => {
    const handler = vi.fn();
    const view = render(<Page handlers={{ n: handler }} />);
    press('n', view.getByLabelText('Field'));
    expect(handler).not.toHaveBeenCalled();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    press('n');
    expect(handler).not.toHaveBeenCalled();
    dialog.remove();
    view.unmount();
  });
});
