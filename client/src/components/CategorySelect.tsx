import { api } from '@/api';
import { useQuery } from '@tanstack/react-query';

interface CategorySelectProps {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  /** Needed when there's no visible label pointing at `id`. */
  'aria-label'?: string;
}

export const SELECT_CLASS =
  // 16px text on phones, or iPhones zoom in when the select is tapped; 40px tall to tap easily.
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-base shadow-xs max-md:h-10 md:text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

export function CategorySelect({
  id,
  value,
  onChange,
  'aria-label': ariaLabel,
}: CategorySelectProps) {
  const { data } = useQuery({ queryKey: ['categories'], queryFn: api.listCategories });

  return (
    <select
      id={id}
      aria-label={ariaLabel}
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
