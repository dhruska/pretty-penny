/** YNAB's flag colors, in the order YNAB lists them. */
export const FLAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;

export type FlagColor = (typeof FLAG_COLORS)[number];

export const isFlagColor = (value: unknown): value is FlagColor =>
  (FLAG_COLORS as readonly unknown[]).includes(value);

/** A flag's display name: its custom name, or the color, such as "Red". */
export const flagLabel = (color: FlagColor, name: string | null | undefined) =>
  name?.trim() || color.charAt(0).toUpperCase() + color.slice(1);
