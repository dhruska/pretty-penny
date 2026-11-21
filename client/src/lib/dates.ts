/** Today's date in the browser's time zone, as YYYY-MM-DD. */
export function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** A date for lists: "Nov 18" this year, "Nov 18, 2025" in any other. */
export function shortDate(date: string, now = today()): string {
  const [year, month, day] = date.split('-');
  const label = `${SHORT_MONTHS[Number(month) - 1]} ${Number(day)}`;
  return year === now.slice(0, 4) ? label : `${label}, ${year}`;
}
