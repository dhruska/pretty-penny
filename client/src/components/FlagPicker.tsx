import { api, FLAG_COLORS, type FlagColor } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { flagColorVar, flagLabel } from '@/lib/flags';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { useId, useState, type FormEvent } from 'react';

/** A flag shape filled with the flag's color, or an outline when there's no flag. */
export function FlagIcon({ color, className }: { color: FlagColor | null; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn('size-4 shrink-0', className)}
      style={color ? { color: flagColorVar(color) } : undefined}
    >
      <path
        d="M3.5 1.5v13M3.5 2.5h8.5l-2 3 2 3H3.5"
        fill={color ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const useFlags = () => useQuery({ queryKey: ['flags'], queryFn: api.listFlags });

/** A colored flag icon labeled with its name, for read-only places like schedules. */
export function FlagBadge({ color }: { color: FlagColor }) {
  const flags = useFlags();
  const label = flagLabel(color, flags.data);
  return (
    <span role="img" aria-label={`Flag: ${label}`} title={label} className="inline-flex">
      <FlagIcon color={color} />
    </span>
  );
}

function FlagNamesForm({ onDone }: { onDone: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const flags = useFlags();
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries((flags.data ?? []).map((flag) => [flag.color, flag.name ?? ''])),
  );
  const save = useMutation({
    mutationFn: async () => {
      for (const flag of flags.data ?? []) {
        const name = names[flag.color]?.trim() ?? '';
        if (name !== (flag.name ?? '')) await api.renameFlag(flag.color, name);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    // The popover renders in a portal, but React still passes events up to a surrounding form,
    // such as the transaction form, which mustn't submit too.
    event.stopPropagation();
    save.mutate();
  }

  return (
    <form aria-label="Flag names" onSubmit={submit} className="space-y-2">
      <p className="text-sm font-medium">Flag names</p>
      {FLAG_COLORS.map((color) => (
        <div key={color} className="flex items-center gap-2">
          <FlagIcon color={color} />
          <Label htmlFor={`${id}-${color}`} className="sr-only">
            {flagLabel(color, undefined)} name
          </Label>
          <Input
            id={`${id}-${color}`}
            className="h-8"
            maxLength={50}
            placeholder={flagLabel(color, undefined)}
            value={names[color] ?? ''}
            onChange={(event) => setNames({ ...names, [color]: event.target.value })}
          />
        </div>
      ))}
      {save.isError && <p className="text-sm text-negative">{save.error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save names
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface FlagPickerProps {
  value: FlagColor | null;
  onChange: (color: FlagColor | null) => void;
  disabled?: boolean;
}

/** A flag button that opens YNAB's six colors, with their names and a way to rename them. */
export function FlagPicker({ value, onChange, disabled }: FlagPickerProps) {
  const flags = useFlags();
  const [open, setOpen] = useState(false);
  const [editingNames, setEditingNames] = useState(false);
  const label = value ? flagLabel(value, flags.data) : 'No flag';

  function choose(color: FlagColor | null) {
    setOpen(false);
    if (color !== value) onChange(color);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditingNames(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Flag: ${label}`}
          title={value ? label : 'Add a flag'}
          disabled={disabled}
          className={cn(
            'inline-flex size-6 cursor-pointer items-center justify-center rounded hover:bg-muted disabled:cursor-default max-md:size-10',
            !value && 'text-muted-foreground/50 hover:text-muted-foreground',
          )}
        >
          <FlagIcon color={value} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-(--radix-popover-content-available-height) w-56 overflow-y-auto p-2"
      >
        {editingNames ? (
          <FlagNamesForm onDone={() => setEditingNames(false)} />
        ) : (
          <div role="group" aria-label="Flag" className="flex flex-col">
            {FLAG_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-pressed={value === color}
                onClick={() => choose(color)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted',
                  value === color && 'bg-muted font-medium',
                )}
              >
                <FlagIcon color={color} />
                <span className="truncate">{flagLabel(color, flags.data)}</span>
              </button>
            ))}
            <button
              type="button"
              aria-pressed={value === null}
              onClick={() => choose(null)}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
            >
              <FlagIcon color={null} />
              No flag
            </button>
            <div className="mt-1 border-t pt-1">
              <button
                type="button"
                onClick={() => setEditingNames(true)}
                className="w-full cursor-pointer rounded px-2 py-1.5 text-left text-sm text-primary hover:bg-muted"
              >
                Edit names
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
