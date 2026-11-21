import { isBudgetType, type AccountType } from '../account-types.js';
import { FLAG_COLORS, isFlagColor, type FlagColor } from '../flags.js';
import { FREQUENCIES, occurrence, type Frequency } from '../schedule.js';
import type {
  YnabAccount,
  YnabCleared,
  YnabPlan,
  YnabSubtransaction,
  YnabTransaction,
} from './types.js';

/** Stands for our Ready to Assign category wherever a YNAB category id would go. */
export const READY_TO_ASSIGN = 'ready-to-assign';

/** A YNAB category id, Ready to Assign, or null for Uncategorized. */
export type CategoryRef = string | null;

const INTERNAL_GROUP = 'Internal Master Category';
const PAYMENT_GROUP = 'Credit Card Payments';
const READY_TO_ASSIGN_NAMES = ['Inflow: Ready to Assign', 'Inflow: To be Budgeted'];
const UNCATEGORIZED_NAME = 'Uncategorized';
const STARTING_BALANCE = 'Starting Balance';

const DEBT_TYPES = [
  'otherLiability',
  'mortgage',
  'autoLoan',
  'studentLoan',
  'personalLoan',
  'medicalDebt',
  'otherDebt',
];

const DIRECT_TYPES: Record<string, AccountType> = {
  checking: 'checking',
  savings: 'savings',
  cash: 'cash',
  creditCard: 'credit_card',
  lineOfCredit: 'line_of_credit',
  otherAsset: 'asset',
};

export interface PlannedAccount {
  ynabId: string;
  name: string;
  ynabType: string;
  type: AccountType;
  onBudget: boolean;
  closed: boolean;
  lastReconciledAt: string | null;
  balanceCents: number;
  clearedBalanceCents: number;
}

export interface PlannedGroup {
  name: string;
  hidden: boolean;
  categories: { ynabId: string; name: string; hidden: boolean }[];
}

export interface PlannedAssignment {
  ynabCategoryId: string;
  month: string;
  cents: number;
}

export interface PlannedLine {
  category: CategoryRef;
  amountCents: number;
  memo: string;
}

export interface PlannedTransaction {
  accountYnabId: string;
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  cleared: YnabCleared;
  isStartingBalance: boolean;
  category: CategoryRef;
  /** Set for a split; `category` is then unused. */
  lines: PlannedLine[] | null;
  flag: FlagColor | null;
  /** Set for a transfer, which also creates the other side. */
  transfer: {
    accountYnabId: string;
    cleared: YnabCleared;
    memo: string;
    flag: FlagColor | null;
  } | null;
}

export interface PlannedSchedule {
  accountYnabId: string;
  frequency: Frequency;
  firstDate: string;
  nextIndex: number;
  nextDate: string;
  payee: string;
  memo: string;
  amountCents: number;
  category: CategoryRef;
  lines: PlannedLine[] | null;
  transferAccountYnabId: string | null;
  flag: FlagColor | null;
}

/** A transaction to look at after importing, listed in the preview and report. */
export interface TransactionToFix {
  reason: 'uncategorized' | 'unpairedTransfer';
  date: string;
  accountName: string;
  payee: string;
  amountCents: number;
}

export interface SkippedSchedule {
  payee: string;
  accountName: string;
  nextDate: string;
  reason: string;
}

/** What the import changes or leaves out, shown in the preview and explained in the report. */
export interface ImportNotes {
  /** YNAB's credit card payment categories, which aren't imported. */
  paymentCategories: { name: string; assignedCents: number; availableCents: number }[];
  /** Split lines that were transfers, imported as separate transfers. */
  splitTransfers: number;
  /** Starting balances in budget accounts that YNAB didn't put in Ready to Assign, such as card debt. */
  startingDebtCents: number;
  /** Budget transactions or split lines without a category. */
  uncategorized: number;
  /** Transactions categorized to a YNAB category that isn't imported, now Uncategorized. */
  recategorized: number;
  /** Transfers whose other side is missing in YNAB, imported as ordinary transactions. */
  unpairedTransfers: number;
  unapproved: number;
  /** Flagged transactions, counting each side of a transfer. */
  flagged: number;
  /** Each color's name, taken from YNAB's transactions; colors without one are left out. */
  flagNames: { color: FlagColor; name: string }[];
  skippedSchedules: SkippedSchedule[];
  /** Uncategorized transactions and unpaired transfers, oldest first. */
  toFix: TransactionToFix[];
}

/** An amount YNAB stores with a fraction of a cent, which needs fixing in YNAB before importing. */
export interface FractionalAmount {
  kind: 'transaction' | 'scheduled' | 'assigned';
  /** The transaction's date, the schedule's next date, or the assignment's month (YYYY-MM). */
  date: string;
  /** The account, or null for an assignment. */
  accountName: string | null;
  /** The payee, transfer or category. */
  name: string;
  milliunits: number;
}

export interface ImportPreview {
  planName: string;
  currency: string | null;
  accounts: PlannedAccount[];
  counts: {
    accounts: number;
    categoryGroups: number;
    categories: number;
    payees: number;
    transactions: number;
    scheduled: number;
    months: number;
  };
  notes: ImportNotes;
  /** Reasons the plan can't be imported; empty when it can. */
  problems: string[];
  /** Amounts to fix in YNAB first; any here also add a problem. */
  fractionalAmounts: FractionalAmount[];
}

export interface ImportPlan {
  preview: ImportPreview;
  accounts: PlannedAccount[];
  groups: PlannedGroup[];
  assignments: PlannedAssignment[];
  transactions: PlannedTransaction[];
  schedules: PlannedSchedule[];
}

/**
 * Picks the Pretty Penny type for a YNAB account. The account stays on the budget or off it as in
 * YNAB; when its type belongs on the other side here, it gets the closest type on its own side.
 */
export function mapAccountType(ynabType: string, onBudget: boolean, balanceCents = 0): AccountType {
  const type: AccountType =
    DIRECT_TYPES[ynabType] ??
    (DEBT_TYPES.includes(ynabType) ? 'liability' : balanceCents < 0 ? 'liability' : 'asset');
  if (isBudgetType(type) === onBudget) return type;
  if (onBudget) return type === 'liability' ? 'line_of_credit' : 'savings';
  return type === 'credit_card' || type === 'line_of_credit' ? 'liability' : 'asset';
}

/**
 * Where an imported schedule starts. Counting from YNAB's first date keeps month-end schedules
 * anchored, but only if our counting reaches YNAB's next date; otherwise it restarts from there.
 */
export function scheduleStart(firstDate: string, frequency: Frequency, nextDate: string) {
  for (let index = 0; index < 10_000; index += 1) {
    const date = occurrence(firstDate, frequency, index);
    if (date === null || date > nextDate) break;
    if (date === nextDate) return { firstDate, nextIndex: index };
  }
  return { firstDate: nextDate, nextIndex: 0 };
}

const byDate = <T extends { date: string }>(items: T[]) =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : a.index - b.index,
    )
    .map(({ item }) => item);

/** Works out everything an import will create from a YNAB plan, without touching the database. */
export function planImport(plan: YnabPlan): ImportPlan {
  const problems: string[] = [];
  // Amounts with a fraction of a cent are found and listed below, so the import is refused.
  const cents = (milliunits: number) => Math.round(milliunits / 10);

  const decimals = plan.currency_format?.decimal_digits ?? 2;
  if (decimals !== 2) {
    problems.push(
      `Pretty Penny stores amounts in cents, so it can only import plans in a currency with 2 decimal places. This plan’s currency uses ${decimals}.`,
    );
  }

  // Accounts
  const accounts: PlannedAccount[] = plan.accounts
    .filter((account) => !account.deleted)
    .map((account: YnabAccount) => ({
      ynabId: account.id,
      name: account.name.trim() || 'Unnamed account',
      ynabType: account.type,
      type: mapAccountType(account.type, account.on_budget, account.balance),
      onBudget: account.on_budget,
      closed: account.closed,
      lastReconciledAt: account.last_reconciled_at ?? null,
      balanceCents: cents(account.balance),
      clearedBalanceCents: cents(account.cleared_balance),
    }));
  const accountById = new Map(accounts.map((account) => [account.ynabId, account]));

  // Categories
  const groupById = new Map(plan.category_groups.map((group) => [group.id, group]));
  const keptGroups = plan.category_groups.filter(
    (group) => !group.deleted && group.name !== INTERNAL_GROUP && group.name !== PAYMENT_GROUP,
  );
  const keptGroupIds = new Set(keptGroups.map((group) => group.id));
  const groupName = (categoryGroupId: string) => groupById.get(categoryGroupId)?.name;

  let readyToAssignId: string | null = null;
  const keptCategoryIds = new Set<string>();
  const uncategorizedIds = new Set<string>();
  const paymentCategoryIds = new Set<string>();
  for (const category of plan.categories) {
    const group = groupName(category.category_group_id);
    if (group === INTERNAL_GROUP && READY_TO_ASSIGN_NAMES.includes(category.name)) {
      readyToAssignId = category.id;
    } else if (group === INTERNAL_GROUP && category.name === UNCATEGORIZED_NAME) {
      uncategorizedIds.add(category.id);
    } else if (group === PAYMENT_GROUP && !category.deleted) {
      paymentCategoryIds.add(category.id);
    } else if (!category.deleted && keptGroupIds.has(category.category_group_id)) {
      keptCategoryIds.add(category.id);
    }
  }

  const groups: PlannedGroup[] = keptGroups.map((group) => ({
    name: group.name.trim() || 'Unnamed group',
    hidden: group.hidden,
    categories: plan.categories
      .filter(
        (category) => category.category_group_id === group.id && keptCategoryIds.has(category.id),
      )
      .map((category) => ({
        ynabId: category.id,
        name: category.name.trim() || 'Unnamed category',
        hidden: category.hidden,
      })),
  }));

  const notes: ImportNotes = {
    paymentCategories: [],
    splitTransfers: 0,
    startingDebtCents: 0,
    uncategorized: 0,
    recategorized: 0,
    unpairedTransfers: 0,
    unapproved: 0,
    flagged: 0,
    flagNames: [],
    skippedSchedules: [],
    toFix: [],
  };

  /** Maps a YNAB category to ours, counting categories that won't come across. */
  const categoryRef = (id: string | null | undefined): CategoryRef => {
    if (!id || uncategorizedIds.has(id)) return null;
    if (id === readyToAssignId) return READY_TO_ASSIGN;
    if (keptCategoryIds.has(id)) return id;
    notes.recategorized += 1;
    return null;
  };

  // Assignments
  const assignments: PlannedAssignment[] = [];
  const paymentAssigned = new Map<string, number>();
  for (const month of plan.months) {
    if (month.deleted) continue;
    for (const category of month.categories) {
      if (category.budgeted === 0 || category.deleted) continue;
      if (paymentCategoryIds.has(category.id)) {
        paymentAssigned.set(
          category.id,
          (paymentAssigned.get(category.id) ?? 0) + cents(category.budgeted),
        );
      } else if (keptCategoryIds.has(category.id)) {
        assignments.push({
          ynabCategoryId: category.id,
          month: month.month.slice(0, 7),
          cents: cents(category.budgeted),
        });
      }
    }
  }
  notes.paymentCategories = plan.categories
    .filter((category) => paymentCategoryIds.has(category.id))
    .map((category) => ({
      name: category.name,
      assignedCents: paymentAssigned.get(category.id) ?? 0,
      availableCents: cents(category.balance),
    }));

  // Transactions
  const payeeName = new Map(plan.payees.map((payee) => [payee.id, payee.name]));
  const payeeOf = (id: string | null | undefined) => (id ? (payeeName.get(id) ?? '') : '');
  const liveTransactions = plan.transactions.filter(
    (transaction) => !transaction.deleted && accountById.has(transaction.account_id),
  );
  const transactionById = new Map(
    liveTransactions.map((transaction) => [transaction.id, transaction]),
  );
  const subsByParent = new Map<string, YnabSubtransaction[]>();
  const subIds = new Set<string>();
  for (const sub of plan.subtransactions) {
    if (sub.deleted) continue;
    subIds.add(sub.id);
    subsByParent.set(sub.transaction_id, [...(subsByParent.get(sub.transaction_id) ?? []), sub]);
  }

  const handled = new Set<string>();
  const startingBalanceSeen = new Set<string>();
  const transactions: PlannedTransaction[] = [];
  const unpaired = new Set<PlannedTransaction>();

  /** The category a transfer keeps: the budget side's, when exactly one side is on the budget. */
  const transferCategory = (
    from: PlannedAccount,
    to: PlannedAccount,
    fromCategoryId: string | null | undefined,
    toCategoryId: string | null | undefined,
  ): CategoryRef => {
    if (from.onBudget === to.onBudget) return null;
    const category = categoryRef(from.onBudget ? fromCategoryId : toCategoryId);
    if (category === null) notes.uncategorized += 1;
    return category;
  };

  const regular = (
    transaction: YnabTransaction,
    account: PlannedAccount,
    fields: Partial<PlannedTransaction>,
  ): PlannedTransaction => ({
    accountYnabId: account.ynabId,
    date: transaction.date,
    payee: payeeOf(transaction.payee_id),
    memo: transaction.memo ?? '',
    amountCents: cents(transaction.amount),
    cleared: transaction.cleared,
    isStartingBalance: false,
    category: null,
    lines: null,
    transfer: null,
    flag: flagOf(transaction.flag_color),
    ...fields,
  });

  /** The other side of a transfer, which YNAB points to from either direction. */
  const partnerOf = (id: string, partnerId: string | null | undefined) =>
    (partnerId ? transactionById.get(partnerId) : undefined) ??
    liveTransactions.find((candidate) => candidate.transfer_transaction_id === id);

  for (const transaction of byDate(liveTransactions)) {
    if (handled.has(transaction.id)) continue;
    handled.add(transaction.id);
    const account = accountById.get(transaction.account_id)!;
    if (!transaction.approved) notes.unapproved += 1;

    const subs = subsByParent.get(transaction.id) ?? [];
    if (subs.length > 0) {
      // A split. Lines that are transfers become separate transfers, which we don't split yet.
      const lineSubs: YnabSubtransaction[] = [];
      let hasUnpaired = false;
      for (const sub of subs) {
        const other = sub.transfer_account_id
          ? accountById.get(sub.transfer_account_id)
          : undefined;
        const partner = sub.transfer_account_id
          ? partnerOf(sub.id, sub.transfer_transaction_id)
          : undefined;
        if (!other || !partner) {
          if (sub.transfer_account_id) {
            notes.unpairedTransfers += 1;
            hasUnpaired = true;
          }
          lineSubs.push(sub);
          continue;
        }
        handled.add(partner.id);
        notes.splitTransfers += 1;
        transactions.push(
          regular(transaction, account, {
            payee: '',
            memo: sub.memo ?? transaction.memo ?? '',
            amountCents: cents(sub.amount),
            category: transferCategory(account, other, sub.category_id, partner.category_id),
            transfer: {
              accountYnabId: other.ynabId,
              cleared: partner.cleared,
              memo: partner.memo ?? '',
              flag: flagOf(partner.flag_color),
            },
          }),
        );
      }
      if (lineSubs.length === 0) continue;

      const lineTotal = lineSubs.reduce((sum, sub) => sum + cents(sub.amount), 0);
      if (!account.onBudget || lineSubs.length === 1) {
        const [only] = lineSubs;
        const category = account.onBudget ? categoryRef(only!.category_id) : null;
        if (account.onBudget && category === null) notes.uncategorized += 1;
        const planned = regular(transaction, account, {
          memo: transaction.memo || (lineSubs.length === 1 ? (only!.memo ?? '') : ''),
          amountCents: lineTotal,
          category,
        });
        transactions.push(planned);
        if (hasUnpaired) unpaired.add(planned);
        continue;
      }
      const lines = lineSubs.map((sub) => {
        const category = categoryRef(sub.category_id);
        if (category === null) notes.uncategorized += 1;
        return { category, amountCents: cents(sub.amount), memo: sub.memo ?? '' };
      });
      const planned = regular(transaction, account, { amountCents: lineTotal, lines });
      transactions.push(planned);
      if (hasUnpaired) unpaired.add(planned);
      continue;
    }

    let isUnpaired = false;
    if (transaction.transfer_account_id) {
      // The other side of a split line that was a transfer is handled with its split.
      if (transaction.transfer_transaction_id && subIds.has(transaction.transfer_transaction_id)) {
        continue;
      }
      const other = accountById.get(transaction.transfer_account_id);
      const partner = partnerOf(transaction.id, transaction.transfer_transaction_id);
      if (other && partner) {
        handled.add(partner.id);
        transactions.push(
          regular(transaction, account, {
            payee: '',
            category: transferCategory(
              account,
              other,
              transaction.category_id,
              partner.category_id,
            ),
            transfer: {
              accountYnabId: other.ynabId,
              cleared: partner.cleared,
              memo: partner.memo ?? '',
              flag: flagOf(partner.flag_color),
            },
          }),
        );
        continue;
      }
      notes.unpairedTransfers += 1;
      isUnpaired = true;
    }

    const isStartingBalance =
      payeeOf(transaction.payee_id) === STARTING_BALANCE &&
      !startingBalanceSeen.has(account.ynabId);
    if (isStartingBalance) startingBalanceSeen.add(account.ynabId);

    let category: CategoryRef = null;
    if (account.onBudget && isStartingBalance) {
      // Our starting balances in budget accounts always go to Ready to Assign.
      category = READY_TO_ASSIGN;
      if (transaction.category_id !== readyToAssignId) {
        notes.startingDebtCents += cents(transaction.amount);
      }
    } else if (account.onBudget) {
      category = categoryRef(transaction.category_id);
      if (category === null) notes.uncategorized += 1;
    }
    // An unpaired transfer becomes an ordinary transaction named after the account it went to.
    const unpairedTo = isUnpaired ? accountById.get(transaction.transfer_account_id!) : undefined;
    const planned = regular(transaction, account, {
      isStartingBalance,
      category,
      ...(unpairedTo && { payee: `Transfer : ${unpairedTo.name}` }),
    });
    transactions.push(planned);
    if (isUnpaired) unpaired.add(planned);
  }

  notes.flagged = transactions.reduce(
    (sum, item) => sum + (item.flag ? 1 : 0) + (item.transfer?.flag ? 1 : 0),
    0,
  );
  notes.flagNames = flagNamesFrom([...plan.transactions, ...plan.scheduled_transactions]);
  notes.toFix = transactionsToFix(transactions, accountById, unpaired);

  // Scheduled transactions
  const scheduledSubsByParent = new Map<string, typeof plan.scheduled_subtransactions>();
  for (const sub of plan.scheduled_subtransactions) {
    if (sub.deleted) continue;
    scheduledSubsByParent.set(sub.scheduled_transaction_id, [
      ...(scheduledSubsByParent.get(sub.scheduled_transaction_id) ?? []),
      sub,
    ]);
  }

  const schedules: PlannedSchedule[] = [];
  for (const scheduled of plan.scheduled_transactions) {
    if (scheduled.deleted) continue;
    const account = accountById.get(scheduled.account_id);
    if (!account) continue;
    const other = scheduled.transfer_account_id
      ? accountById.get(scheduled.transfer_account_id)
      : undefined;
    const subs = scheduledSubsByParent.get(scheduled.id) ?? [];
    const skip = (reason: string) =>
      notes.skippedSchedules.push({
        payee: other ? `Transfer : ${other.name}` : payeeOf(scheduled.payee_id),
        accountName: account.name,
        nextDate: scheduled.date_next,
        reason,
      });

    if (account.closed || other?.closed) {
      skip('Its account is closed.');
      continue;
    }
    if (scheduled.transfer_account_id && !other) {
      skip('The account it transfers to no longer exists.');
      continue;
    }
    if (!(FREQUENCIES as readonly string[]).includes(scheduled.frequency)) {
      skip('It repeats on a schedule Pretty Penny doesn’t support.');
      continue;
    }
    if (subs.some((sub) => sub.transfer_account_id)) {
      skip('One of its split lines is a transfer, which Pretty Penny doesn’t support yet.');
      continue;
    }

    const frequency = scheduled.frequency as Frequency;
    let category: CategoryRef = null;
    let lines: PlannedLine[] | null = null;
    if (other) {
      category = account.onBudget === other.onBudget ? null : categoryRef(scheduled.category_id);
    } else if (account.onBudget && subs.length > 1) {
      lines = subs.map((sub) => ({
        category: categoryRef(sub.category_id),
        amountCents: cents(sub.amount),
        memo: sub.memo ?? '',
      }));
    } else if (account.onBudget) {
      category = categoryRef(subs.length === 1 ? subs[0]!.category_id : scheduled.category_id);
    }

    schedules.push({
      accountYnabId: account.ynabId,
      frequency,
      ...scheduleStart(scheduled.date_first, frequency, scheduled.date_next),
      nextDate: scheduled.date_next,
      payee: other ? '' : payeeOf(scheduled.payee_id),
      memo: scheduled.memo ?? '',
      amountCents: cents(scheduled.amount),
      category,
      lines,
      transferAccountYnabId: other?.ynabId ?? null,
      flag: flagOf(scheduled.flag_color),
    });
  }

  const fractionalAmounts = findFractionalAmounts(
    plan,
    accountById,
    payeeOf,
    (id) => keptCategoryIds.has(id) || paymentCategoryIds.has(id),
  );
  if (fractionalAmounts.length > 0) {
    problems.push(
      `${fractionalAmounts.length === 1 ? 'This amount has' : 'These amounts have'} a fraction of a cent, which Pretty Penny can’t store. Change ${fractionalAmounts.length === 1 ? 'it' : 'them'} to whole cents in YNAB, then connect again.`,
    );
  }

  const payeeNames = new Set(
    [...transactions, ...schedules]
      .map((item) => item.payee.trim().toLowerCase())
      .filter((name) => name !== ''),
  );

  return {
    preview: {
      planName: plan.name,
      currency: plan.currency_format?.iso_code ?? null,
      accounts,
      counts: {
        accounts: accounts.length,
        categoryGroups: groups.length,
        categories: groups.reduce((sum, group) => sum + group.categories.length, 0),
        payees: payeeNames.size,
        transactions: transactions.reduce((sum, item) => sum + (item.transfer ? 2 : 1), 0),
        scheduled: schedules.length,
        months: new Set(assignments.map((assignment) => assignment.month)).size,
      },
      notes,
      problems,
      fractionalAmounts,
    },
    accounts,
    groups,
    assignments,
    transactions,
    schedules,
  };
}

const hasFraction = (milliunits: number) => milliunits % 10 !== 0;

/** The first amount with a fraction of a cent: the total, or else one of its split lines. */
const fractionIn = (amount: number, subs: { amount: number; deleted: boolean }[] = []) =>
  [amount, ...subs.filter((sub) => !sub.deleted).map((sub) => sub.amount)].find(hasFraction);

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/**
 * Amounts with a fraction of a cent that you can edit in YNAB: transactions (listed once per
 * transfer), scheduled transactions and assignments. Balances are left out, since they follow
 * from these.
 */
function findFractionalAmounts(
  plan: YnabPlan,
  accountById: Map<string, PlannedAccount>,
  payeeOf: (id: string | null | undefined) => string,
  isImportedCategory: (id: string) => boolean,
): FractionalAmount[] {
  const found: FractionalAmount[] = [];
  const nameOf = (item: { payee_id?: string | null; transfer_account_id?: string | null }) => {
    const other = item.transfer_account_id ? accountById.get(item.transfer_account_id) : undefined;
    return other ? `Transfer : ${other.name}` : payeeOf(item.payee_id);
  };

  const subsOf = groupBy(plan.subtransactions, (sub) => sub.transaction_id);
  const scheduledSubsOf = groupBy(
    plan.scheduled_subtransactions,
    (sub) => sub.scheduled_transaction_id,
  );

  const listed = new Set<string>();
  for (const transaction of plan.transactions) {
    const account = accountById.get(transaction.account_id);
    if (transaction.deleted || !account) continue;
    if (transaction.transfer_transaction_id && listed.has(transaction.transfer_transaction_id)) {
      continue;
    }
    const milliunits = fractionIn(transaction.amount, subsOf.get(transaction.id));
    if (milliunits === undefined) continue;
    listed.add(transaction.id);
    found.push({
      kind: 'transaction',
      date: transaction.date,
      accountName: account.name,
      name: nameOf(transaction),
      milliunits,
    });
  }

  for (const scheduled of plan.scheduled_transactions) {
    const account = accountById.get(scheduled.account_id);
    if (scheduled.deleted || !account) continue;
    const milliunits = fractionIn(scheduled.amount, scheduledSubsOf.get(scheduled.id));
    if (milliunits === undefined) continue;
    found.push({
      kind: 'scheduled',
      date: scheduled.date_next,
      accountName: account.name,
      name: nameOf(scheduled),
      milliunits,
    });
  }

  const categoryName = new Map(plan.categories.map((category) => [category.id, category.name]));
  for (const month of plan.months) {
    if (month.deleted) continue;
    for (const category of month.categories) {
      if (category.deleted || !hasFraction(category.budgeted) || !isImportedCategory(category.id)) {
        continue;
      }
      found.push({
        kind: 'assigned',
        date: month.month.slice(0, 7),
        accountName: null,
        name: categoryName.get(category.id) ?? category.name,
        milliunits: category.budgeted,
      });
    }
  }

  return found.sort((a, b) => a.date.localeCompare(b.date));
}

const flagOf = (color: string | null | undefined): FlagColor | null =>
  isFlagColor(color) ? color : null;

/**
 * YNAB has no list of flag names; each flagged item carries its color's name. Each color takes
 * the name used most, with ties going to the name that sorts first.
 */
export function flagNamesFrom(
  items: { flag_color?: string | null; flag_name?: string | null; deleted: boolean }[],
) {
  const counts = new Map<FlagColor, Map<string, number>>();
  for (const item of items) {
    const name = item.flag_name?.trim();
    if (item.deleted || !isFlagColor(item.flag_color) || !name) continue;
    const names = counts.get(item.flag_color) ?? new Map<string, number>();
    names.set(name, (names.get(name) ?? 0) + 1);
    counts.set(item.flag_color, names);
  }
  return FLAG_COLORS.flatMap((color) => {
    const names = [...(counts.get(color) ?? new Map<string, number>())];
    names.sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b));
    return names.length > 0 ? [{ color, name: names[0]![0] }] : [];
  });
}

/** Uncategorized transactions that need a category, and transfers missing their other side. */
function transactionsToFix(
  transactions: PlannedTransaction[],
  accountById: Map<string, PlannedAccount>,
  unpaired: Set<PlannedTransaction>,
): TransactionToFix[] {
  const found: TransactionToFix[] = [];
  for (const item of transactions) {
    const account = accountById.get(item.accountYnabId)!;
    const other = item.transfer ? accountById.get(item.transfer.accountYnabId)! : null;
    const payee = other ? `Transfer : ${other.name}` : item.payee;
    const base = {
      date: item.date,
      accountName: account.name,
      payee,
      amountCents: item.amountCents,
    };
    // Only money entering or leaving the budget has a category.
    const needsCategory = other ? account.onBudget !== other.onBudget : account.onBudget;
    const uncategorized = item.lines
      ? item.lines.some((line) => line.category === null)
      : item.category === null;
    if (needsCategory && uncategorized) found.push({ reason: 'uncategorized', ...base });
    if (unpaired.has(item)) found.push({ reason: 'unpairedTransfer', ...base });
  }
  return found;
}
