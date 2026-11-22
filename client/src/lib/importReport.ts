import type {
  FractionalAmount,
  ImportNotes,
  TransactionToFix,
  ImportReport,
  ReadyToAssignPartKey,
} from '@/api';
import { formatCents } from './money';
import { flagLabel } from './flags';
import { formatMonth } from './months';

const YNAB_TYPE_LABELS: Record<string, string> = {
  creditCard: 'Credit Card',
  lineOfCredit: 'Line of Credit',
  otherAsset: 'Asset',
  otherLiability: 'Liability',
  otherDebt: 'Other Debt',
};

/** YNAB's account type names, such as "autoLoan", as words: "Auto Loan". */
export function ynabTypeLabel(type: string): string {
  return (
    YNAB_TYPE_LABELS[type] ??
    type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
  );
}

export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** A signed amount, such as +$300.00 or -$50.00. */
export function signedCents(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

/** "Dec 1, 2026" style dates. */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** YNAB's milliunits as dollars with three decimals, such as -$1,234.567. */
export function formatMilliunits(milliunits: number): string {
  const absolute = Math.abs(milliunits);
  const whole = String(Math.floor(absolute / 1000)).replace(/\B(?=(\d{3})+$)/g, ',');
  const fraction = String(absolute % 1000).padStart(3, '0');
  return `${milliunits < 0 ? '-' : ''}$${whole}.${fraction}`;
}

/** Where to find an amount with a fraction of a cent in YNAB. */
export function fractionalAmountLine(item: FractionalAmount): string {
  const amount = formatMilliunits(item.milliunits);
  if (item.kind === 'assigned') {
    return `Assigned to ${item.name} in ${formatMonth(item.date)}: ${amount}`;
  }
  const name = item.name || 'No payee';
  const when =
    item.kind === 'scheduled'
      ? `Scheduled, next on ${formatDate(item.date)}`
      : formatDate(item.date);
  return `${when} · ${item.accountName} · ${name}: ${amount}`;
}

/** Plain-language lines describing what an import changes or leaves out. */
export function noteLines(notes: ImportNotes): string[] {
  const lines: string[] = [];
  if (notes.paymentCategories.length > 0) {
    const names = notes.paymentCategories
      .map((category) => `${category.name} (${formatCents(category.assignedCents)} assigned)`)
      .join(', ');
    lines.push(
      `Credit card payment categories aren’t imported, since Pretty Penny treats cards like cash: ${names}.`,
    );
  }
  if (notes.startingDebtCents !== 0) {
    lines.push(
      `Starting balances YNAB kept out of Ready to Assign, such as card debt, go to Ready to Assign: ${signedCents(notes.startingDebtCents)}.`,
    );
  }
  if (notes.splitTransfers > 0) {
    lines.push(
      `${plural(notes.splitTransfers, 'split line that is a transfer becomes', 'split lines that are transfers become')} a separate transfer on the same date.`,
    );
  }
  if (notes.uncategorized > 0) {
    lines.push(
      `${plural(notes.uncategorized, 'transaction or split line has', 'transactions or split lines have')} no category. Pretty Penny leaves these out of the budget until they’re categorized.`,
    );
  }
  if (notes.recategorized > 0) {
    lines.push(
      notes.recategorized === 1
        ? '1 transaction moves to Uncategorized, because its category isn’t imported.'
        : `${notes.recategorized} transactions move to Uncategorized, because their categories aren’t imported.`,
    );
  }
  if (notes.unpairedTransfers > 0) {
    lines.push(
      `${plural(notes.unpairedTransfers, 'transfer is', 'transfers are')} missing the other side in YNAB and become ordinary transactions.`,
    );
  }
  if (notes.unapproved > 0) {
    lines.push(
      `${plural(notes.unapproved, 'unapproved transaction needs', 'unapproved transactions need')} review, as in YNAB.`,
    );
  }
  if (notes.flagged > 0) {
    const names = notes.flagNames
      .map((flag) => `${flagLabel(flag.color, undefined)} is “${flag.name}”`)
      .join(', ');
    lines.push(
      `${plural(notes.flagged, 'flagged transaction keeps its flag', 'flagged transactions keep their flags')}${names ? `. Flag names: ${names}` : ''}.`,
    );
  }
  lines.push(
    'Targets, category and account notes, and payee locations aren’t imported. Transaction memos are.',
  );
  return lines;
}

const TO_FIX_REASONS: Record<TransactionToFix['reason'], string> = {
  uncategorized: 'needs a category',
  unpairedTransfer: 'transfer missing its other side in YNAB',
};

/** A transaction to look at after importing, such as "Oct 20, 2026 · Checking · Shop: …". */
export function toFixLine(item: TransactionToFix): string {
  const payee = item.payee || 'No payee';
  return `${formatDate(item.date)} · ${item.accountName} · ${payee} · ${formatCents(item.amountCents)}: ${TO_FIX_REASONS[item.reason]}`;
}

/** A skipped scheduled transaction, such as "Rent in Checking, next on Dec 1, 2026: …". */
export function skippedScheduleLine(schedule: ImportNotes['skippedSchedules'][number]): string {
  const name = schedule.payee || 'A scheduled transaction';
  return `${name} in ${schedule.accountName}, next on ${formatDate(schedule.nextDate)}: ${schedule.reason}`;
}

const PART_TEXT: Record<ReadyToAssignPartKey, string> = {
  paymentCategories:
    'assigned to credit card payment categories returns to Ready to Assign, since they aren’t imported.',
  startingDebt: 'of starting debt comes out of Ready to Assign, as for any budget account.',
  uncategorized:
    'of uncategorized spending YNAB took from Ready to Assign, which Pretty Penny leaves out until it’s categorized.',
  creditOverspending:
    'most likely from credit card overspending, which YNAB adds to the card’s balance and Pretty Penny takes from Ready to Assign, as with cash.',
  unexplained: 'isn’t explained by any known difference and is worth investigating.',
};

/** One cause of a Ready to Assign difference, such as "+$300.00 assigned to …". */
export function partLine(part: { key: ReadyToAssignPartKey; cents: number }): string {
  return `${signedCents(part.cents)} ${PART_TEXT[part.key]}`;
}

/** Whether the report found anything that needs a closer look. */
export function needsAttention(report: ImportReport): boolean {
  return (
    report.accounts.some((account) => !account.matches) ||
    report.categoryDifferences.length > 0 ||
    report.readyToAssign.parts.some((part) => part.key === 'unexplained')
  );
}

/** The comparison report as plain text, for downloading. */
export function reportText(report: ImportReport): string {
  const out: string[] = ['Pretty Penny: YNAB import report', ''];

  out.push('Account balances (here / YNAB, cleared here / YNAB)');
  for (const account of report.accounts) {
    out.push(
      `  ${account.matches ? 'OK  ' : 'DIFF'} ${account.name}: ${formatCents(account.balanceCents)} / ${formatCents(account.ynabBalanceCents)}, cleared ${formatCents(account.clearedCents)} / ${formatCents(account.ynabClearedCents)}`,
    );
  }

  const { readyToAssign } = report;
  out.push('', `Budget for ${formatMonth(report.month)}`);
  out.push(
    `  Ready to Assign: ${formatCents(readyToAssign.cents)} here, ${formatCents(readyToAssign.ynabCents)} in YNAB`,
  );
  for (const part of readyToAssign.parts) out.push(`    ${partLine(part)}`);
  if (report.categoryDifferences.length === 0) {
    out.push(`  All ${report.categoriesCompared} categories’ Available match YNAB.`);
  } else {
    for (const difference of report.categoryDifferences) {
      out.push(
        `  DIFF ${difference.groupName}: ${difference.name}: ${formatCents(difference.availableCents)} here, ${formatCents(difference.ynabAvailableCents)} in YNAB, since ${formatMonth(difference.firstMonth)}`,
      );
    }
  }

  const { counts } = report;
  out.push(
    '',
    'Imported',
    `  ${plural(counts.accounts, 'account', 'accounts')}, ${plural(counts.categories, 'category', 'categories')} in ${plural(counts.categoryGroups, 'group', 'groups')}, ${plural(counts.transactions, 'transaction', 'transactions')}, ${plural(counts.payees, 'payee', 'payees')}, ${plural(counts.scheduled, 'scheduled transaction', 'scheduled transactions')}, ${plural(counts.months, 'month', 'months')} of assignments`,
  );

  if (report.notes.toFix.length > 0) {
    out.push('', 'To fix after importing');
    for (const item of report.notes.toFix) out.push(`  ${toFixLine(item)}`);
  }

  out.push('', 'Changes from YNAB');
  for (const line of noteLines(report.notes)) out.push(`  ${line}`);
  for (const schedule of report.notes.skippedSchedules) {
    out.push(`  Skipped scheduled transaction: ${skippedScheduleLine(schedule)}`);
  }
  return `${out.join('\n')}\n`;
}
