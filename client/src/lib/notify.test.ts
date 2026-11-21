import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { notify, notifyDeleted, notifyError, UNDO_MS } from './notify';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe('messages', () => {
  it('confirm actions and explain errors', () => {
    notify('Transaction added');
    expect(toast.success).toHaveBeenCalledWith('Transaction added');
    notifyError(new Error('Not allowed.'));
    expect(toast.error).toHaveBeenCalledWith('Not allowed.');
    notifyError('something odd');
    expect(toast.error).toHaveBeenLastCalledWith('That didn’t work. Try again.');
  });

  it('offer Undo after a delete, which restores the transaction and refreshes', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    const restore = vi.spyOn(api, 'restoreTransaction').mockResolvedValue({ restored: [4] });
    const undo = { snapshot: {}, signature: 's' };

    notifyDeleted(client, undo);
    const [message, options] = vi.mocked(toast.success).mock.calls[0]!;
    expect(message).toBe('Transaction deleted');
    expect(options).toMatchObject({ duration: UNDO_MS, action: { label: 'Undo' } });

    const action = (options as unknown as { action: { onClick: () => Promise<void> } }).action;
    await action.onClick();
    expect(restore).toHaveBeenCalledWith(undo);
    expect(invalidate).toHaveBeenCalled();
    expect(toast.success).toHaveBeenLastCalledWith('Transaction restored');

    restore.mockRejectedValueOnce(new Error('Couldn’t undo: its account was deleted.'));
    await action.onClick();
    expect(toast.error).toHaveBeenCalledWith('Couldn’t undo: its account was deleted.');
  });
});
