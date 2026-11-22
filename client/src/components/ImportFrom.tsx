import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { shortDate } from '@/lib/dates';
import { notify } from '@/lib/notify';
import { refresh } from '@/lib/queries';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';

/**
 * Where importing into a linked account starts, with Change. Moving it earlier brings in the
 * bank's earlier transactions, matching any you entered.
 */
export function ImportFrom({
  bankAccountId,
  importFrom,
}: {
  bankAccountId: number;
  importFrom: string | null;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(importFrom ?? '');

  const save = useMutation({
    mutationFn: () => api.setImportFrom(bankAccountId, date),
    onSuccess: () => {
      setEditing(false);
      refresh(queryClient, 'imports');
      notify(`Importing from ${shortDate(date)}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    // It can sit inside another form, such as Edit account's dialog.
    event.stopPropagation();
    if (date) save.mutate();
  }

  if (!editing) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
        {importFrom ? `Importing from ${shortDate(importFrom)}` : 'Importing soon'}
        <button
          type="button"
          className="cursor-pointer text-xs font-medium text-accent-ink hover:underline"
          onClick={() => {
            setDate(importFrom ?? '');
            save.reset();
            setEditing(true);
          }}
        >
          Change
        </button>
      </p>
    );
  }

  return (
    <form
      aria-label="Where importing starts"
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <label htmlFor={`${id}-from`} className="text-muted-foreground">
        Import from
      </label>
      <Input
        id={`${id}-from`}
        type="date"
        className="h-8 w-40"
        value={date}
        onChange={(event) => setDate(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={!date || save.isPending}>
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {save.isError && <p className="w-full text-negative">{save.error.message}</p>}
    </form>
  );
}
