import { api } from '@/api';
import { useQuery } from '@tanstack/react-query';

interface CategorySelectProps {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
}

export const SELECT_CLASS =
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

export function CategorySelect({ id, value, onChange }: CategorySelectProps) {
  const { data } = useQuery({ queryKey: ['categories'], queryFn: api.listCategories });

  return (
    <select
      id={id}
      className={SELECT_CLASS}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
    >
      <option value="">Uncategorized</option>
      {data && <option value={data.readyToAssignId}>Ready to Assign</option>}
      {data?.groups.map((group) => {
        // A hidden category stays available if this transaction already uses it.
        const options = group.categories.filter(
          (category) => (!category.hidden && !group.hidden) || category.id === value,
        );
        if (options.length === 0) return null;

        return (
          <optgroup key={group.id} label={group.name}>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
