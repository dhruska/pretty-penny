const DOLLARS_PATTERN = /^(-?)\$?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{0,2}))?$/;
const MAX_WHOLE_DOLLAR_DIGITS = 10;

/** Parses text like "1,234.56" into integer cents, or returns null if it isn't a valid amount. */
export function parseDollars(input: string): number | null {
  const match = DOLLARS_PATTERN.exec(input.trim());
  if (!match) return null;

  const [, sign, wholeText = '', fractionText = ''] = match;
  const whole = wholeText.replaceAll(',', '');
  if (whole === '' && fractionText === '') return null;
  if (whole.length > MAX_WHOLE_DOLLAR_DIGITS) return null;

  const cents = Number(whole || '0') * 100 + Number(fractionText.padEnd(2, '0'));
  if (cents === 0) return 0;
  return sign ? -cents : cents;
}

function splitCents(cents: number) {
  const absolute = Math.abs(cents);
  const remainder = absolute % 100;
  return {
    dollars: (absolute - remainder) / 100,
    fraction: String(remainder).padStart(2, '0'),
  };
}

/** Formats integer cents for display, such as -$1,234.56. */
export function formatCents(cents: number): string {
  const { dollars, fraction } = splitCents(cents);
  const whole = String(dollars).replace(/\B(?=(\d{3})+$)/g, ',');
  return `${cents < 0 ? '-' : ''}$${whole}.${fraction}`;
}

/** Formats the size of an amount for a form field, such as 1234.56. */
export function centsToInput(cents: number): string {
  const { dollars, fraction } = splitCents(cents);
  return `${dollars}.${fraction}`;
}

export type AmountResult = { cents: number; error?: undefined } | { error: string };

/** Converts the outflow and inflow form fields into one signed amount. */
export function amountFromFields(outflow: string, inflow: string): AmountResult {
  const hasOutflow = outflow.trim() !== '';
  const hasInflow = inflow.trim() !== '';

  if (hasOutflow === hasInflow) {
    return {
      error: hasOutflow
        ? 'Enter an outflow or an inflow, not both.'
        : 'Enter an outflow or inflow.',
    };
  }

  const cents = parseDollars(hasOutflow ? outflow : inflow);
  if (cents === null || cents < 0) {
    return { error: 'Enter a positive amount with at most two decimal places.' };
  }
  if (cents === 0) return { error: 'The amount can’t be zero.' };

  return { cents: hasOutflow ? -cents : cents };
}
