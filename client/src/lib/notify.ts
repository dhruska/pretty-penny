import { api, type DeletedTransaction } from '@/api';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { refresh } from './queries';

/** A short message at the bottom of the screen, for actions that aren't otherwise visible. */
export const notify = (message: string) => toast.success(message);

/** A failed quick action, such as toggling cleared, explained where you'll see it. */
export const notifyError = (error: unknown) =>
  toast.error(error instanceof Error ? error.message : 'That didn’t work. Try again.');

/** How long Undo stays offered after deleting a transaction. */
export const UNDO_MS = 8000;

/** Confirms a delete, offering Undo, which puts the transaction back exactly as it was. */
export function notifyDeleted(queryClient: QueryClient, undo: DeletedTransaction) {
  toast.success('Transaction deleted', {
    duration: UNDO_MS,
    action: {
      label: 'Undo',
      onClick: async () => {
        try {
          await api.restoreTransaction(undo);
          refresh(queryClient, 'transactions');
          notify('Transaction restored');
        } catch (error) {
          notifyError(error);
        }
      },
    },
  });
}
