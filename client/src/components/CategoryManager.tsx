import { api, type MoveDirection } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { useState, type FormEvent, type ReactNode } from 'react';
import { SELECT_CLASS } from './CategorySelect';
import { ConfirmDelete } from './ConfirmDelete';

function AddNameForm({
  label,
  buttonLabel,
  onAdd,
}: {
  label: string;
  buttonLabel: string;
  onAdd: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '') return;
    try {
      await onAdd(name);
      setName('');
    } catch {
      // The manager shows the error, and the typed name stays for another try.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        aria-label={label}
        placeholder={label}
        maxLength={100}
        className="h-8 max-w-64"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" variant="secondary" size="sm">
        {buttonLabel}
      </Button>
    </form>
  );
}

interface ManageRowProps {
  name: string;
  hidden: boolean;
  isFirst: boolean;
  isLast: boolean;
  deleteTitle: string;
  emphasized?: boolean;
  children?: ReactNode;
  onRename: (name: string) => void;
  onSetHidden: (hidden: boolean) => void;
  onMove: (direction: MoveDirection) => void;
  onDelete: () => void;
}

function ManageRow({
  name,
  hidden,
  isFirst,
  isLast,
  deleteTitle,
  emphasized,
  children,
  onRename,
  onSetHidden,
  onMove,
  onDelete,
}: ManageRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(name);

  function handleRename(event: FormEvent) {
    event.preventDefault();
    if (draft.trim() === '') return;
    onRename(draft);
    setIsRenaming(false);
  }

  if (isRenaming) {
    return (
      <form onSubmit={handleRename} className="flex items-center gap-2 py-1">
        <Input
          aria-label={`New name for ${name}`}
          maxLength={100}
          className="h-8 max-w-64"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(name);
            setIsRenaming(false);
          }}
        >
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 text-sm">
      <span className={cn(emphasized && 'font-medium', hidden && 'text-muted-foreground')}>
        {name}
        {hidden && ' (hidden)'}
      </span>
      <div className="flex flex-wrap items-center gap-0.5">
        {children}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Move ${name} up`}
          disabled={isFirst}
          onClick={() => onMove('up')}
        >
          Up
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Move ${name} down`}
          disabled={isLast}
          onClick={() => onMove('down')}
        >
          Down
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Rename ${name}`}
          onClick={() => setIsRenaming(true)}
        >
          Rename
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${hidden ? 'Unhide' : 'Hide'} ${name}`}
          onClick={() => onSetHidden(!hidden)}
        >
          {hidden ? 'Unhide' : 'Hide'}
        </Button>
        <ConfirmDelete
          triggerLabel="Delete"
          title={deleteTitle}
          description="Only unused categories and empty groups can be deleted."
          onConfirm={onDelete}
        />
      </div>
    </div>
  );
}

export function CategoryManager() {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.listCategories });
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  if (categories.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (categories.isError) return <p className="text-negative">{categories.error.message}</p>;

  const { groups } = categories.data;

  return (
    <div className="space-y-4">
      {action.isError && <p className="text-sm text-negative">{action.error.message}</p>}

      {groups.map((group, groupIndex) => (
        <section
          key={group.id}
          aria-label={`${group.name} group`}
          className="rounded-lg border bg-card p-3"
        >
          <ManageRow
            name={group.name}
            hidden={group.hidden}
            emphasized
            isFirst={groupIndex === 0}
            isLast={groupIndex === groups.length - 1}
            deleteTitle={`Delete the ${group.name} group?`}
            onRename={(name) => action.mutate(() => api.updateGroup(group.id, { name }))}
            onSetHidden={(hidden) => action.mutate(() => api.updateGroup(group.id, { hidden }))}
            onMove={(direction) => action.mutate(() => api.moveGroup(group.id, direction))}
            onDelete={() => action.mutate(() => api.deleteGroup(group.id))}
          />

          <div className="mt-1 divide-y border-t pl-3">
            {group.categories.map((category, categoryIndex) => (
              <ManageRow
                key={category.id}
                name={category.name}
                hidden={category.hidden}
                isFirst={categoryIndex === 0}
                isLast={categoryIndex === group.categories.length - 1}
                deleteTitle={`Delete ${category.name}?`}
                onRename={(name) => action.mutate(() => api.updateCategory(category.id, { name }))}
                onSetHidden={(hidden) =>
                  action.mutate(() => api.updateCategory(category.id, { hidden }))
                }
                onMove={(direction) =>
                  action.mutate(() => api.moveCategory(category.id, direction))
                }
                onDelete={() => action.mutate(() => api.deleteCategory(category.id))}
              >
                {groups.length > 1 && (
                  <select
                    aria-label={`Group for ${category.name}`}
                    className={cn(SELECT_CLASS, 'h-8 w-36')}
                    value={group.id}
                    onChange={(event) => {
                      const groupId = Number(event.target.value);
                      action.mutate(() => api.updateCategory(category.id, { groupId }));
                    }}
                  >
                    {groups.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                )}
              </ManageRow>
            ))}
          </div>

          <div className="mt-2">
            <AddNameForm
              label={`New category in ${group.name}`}
              buttonLabel="Add category"
              onAdd={(name) => action.mutateAsync(() => api.createCategory(group.id, name))}
            />
          </div>
        </section>
      ))}

      <AddNameForm
        label="New group name"
        buttonLabel="Add group"
        onAdd={(name) => action.mutateAsync(() => api.createGroup(name))}
      />
    </div>
  );
}
