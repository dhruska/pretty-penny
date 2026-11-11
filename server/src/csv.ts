/** Quotes every field, doubling any quotes inside it, and joins rows with CRLF as CSV expects. */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(','))
    .join('\r\n')
    .concat('\r\n');
}

/** Formats cents the way YNAB's exports do, such as $1,234.56 or -$5.00. */
export function exportMoney(cents: number): string {
  const absolute = Math.abs(cents);
  const remainder = absolute % 100;
  const dollars = String((absolute - remainder) / 100).replace(/\B(?=(\d{3})+$)/g, ',');
  return `${cents < 0 ? '-' : ''}$${dollars}.${String(remainder).padStart(2, '0')}`;
}

/** YYYY-MM-DD as MM/DD/YYYY, as YNAB's exports write dates. */
export function exportDate(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
}

const MONTH_ABBREVIATIONS = [
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

/** YYYY-MM as "Nov 2026", as YNAB's budget export writes months. */
export function exportMonth(month: string): string {
  return `${MONTH_ABBREVIATIONS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}
