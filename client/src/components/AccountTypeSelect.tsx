import { ACCOUNT_TYPE_GROUPS, accountTypeLabel } from '@/lib/accountTypes';
import { cn } from 'cn';
import { SELECT_CLASS } from './CategorySelect';

interface AccountTypeSelectProps {
  value: string;
  onChange: (type: string) => void;
  id?: string;
  label?: string;
  /** Limits the choices to budget or tracking types. */
  onBudget?: boolean;
  /** Uses short labels without examples. */
  compact?: boolean;
  className?: string;
}

export function AccountTypeSelect({
  value,
  onChange,
  id,
  label,
  onBudget,
  compact,
  className,
}: AccountTypeSelectProps) {
  const groups = ACCOUNT_TYPE_GROUPS.filter(
    (group) => onBudget === undefined || group.onBudget === onBudget,
  );

  return (
    <select
      id={id}
      aria-label={label}
      className={cn(SELECT_CLASS, className)}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.types.map((option) => (
            <option key={option.value} value={option.value}>
              {compact ? accountTypeLabel(option.value) : option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
