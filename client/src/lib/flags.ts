import type { Flag, FlagColor } from '@/api';

/** A flag's name for display: its custom name, or its color, such as "Red". */
export function flagLabel(color: FlagColor, flags: Flag[] | undefined): string {
  const name = flags?.find((flag) => flag.color === color)?.name?.trim();
  return name || color.charAt(0).toUpperCase() + color.slice(1);
}

/** The CSS color for a flag, from the tokens in index.css. */
export const flagColorVar = (color: FlagColor) => `var(--flag-${color})`;
