import { signInPath } from './lib/signIn';

export interface Account {
  id: number;
  name: string;
  type: string;
  onBudget: boolean;
  closed: boolean;
  balanceCents: number;
  clearedBalanceCents: number;
  lastReconciledAt: string | null;
  /** Transactions from the bank still needing review. */
  unapprovedCount: number;
  /** The bank account it's linked to through Plaid, if any. */
  bank: AccountBank | null;
}

/** 'needs_sign_in' and 'error' come with a message saying what to do. */
export type ConnectionStatus = 'ok' | 'needs_sign_in' | 'error';

export interface AccountBank {
  bankAccountId: number;
  connectionId: number;
  /** Where importing starts, as YYYY-MM-DD. */
  importFrom: string | null;
  institutionName: string;
  mask: string | null;
  /** Negative when money is owed. Null when the bank doesn't say. */
  balanceCents: number | null;
  status: ConnectionStatus;
  problem: string | null;
  updatedAt: string | null;
}

export interface BankStatus {
  configured: boolean;
  environment: 'sandbox' | 'production' | null;
  /** What's missing from .env. */
  problems: string[];
}

export interface BankAccount {
  id: number;
  name: string;
  mask: string | null;
  plaidType: string;
  plaidSubtype: string | null;
  balanceCents: number | null;
  accountId: number | null;
  accountName: string | null;
  /** Where importing starts, as YYYY-MM-DD, once linked. */
  importFrom: string | null;
  /** What a new account for it starts as. */
  suggestedType: string;
}

export interface BankConnection {
  id: number;
  institutionName: string;
  status: ConnectionStatus;
  problem: string | null;
  updatedAt: string | null;
  /** Right after connecting, while Plaid gathers history. */
  gettingTransactions: boolean;
  accounts: BankAccount[];
}

/** A bank transaction that hasn't posted yet; it doesn't affect any balance. */
export interface PendingTransaction {
  id: number;
  date: string;
  payee: string;
  amountCents: number;
}

/** Reconciled transactions are locked; only reconciling an account sets that status. */
export type ClearedStatus = 'uncleared' | 'cleared' | 'reconciled';

/** An error from the API, with the code the server sends for errors the UI can act on. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** Whether an error means a reconciled transaction needs confirmation to change. */
export const isReconciledError = (error: unknown) =>
  error instanceof ApiError && error.code === 'RECONCILED';

/** YNAB's flag colors, in YNAB's order. */
export const FLAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type FlagColor = (typeof FLAG_COLORS)[number];

/** A flag color with its custom name, or null when unnamed. */
export interface Flag {
  color: FlagColor;
  name: string | null;
}

export interface Transaction {
  id: number;
  accountId: number;
  accountName: string;
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  cleared: ClearedStatus;
  flag: FlagColor | null;
  categoryId: number | null;
  categoryName: string | null;
  hasCategoryLine: boolean;
  transferAccountId: number | null;
  transferAccountName: string | null;
  /** One line normally, or several for a split. */
  lines: TransactionLine[];
  /** False for a transaction from the bank that still needs review. */
  approved: boolean;
  /** The bank transaction it came from or matched, with the bank's own text. */
  bank: { name: string; matched: boolean; institutionName: string } | null;
  /** Only in a single account's register. */
  runningBalanceCents?: number;
}

/** What the server returns from a delete, passed back as is to undo it. */
export interface DeletedTransaction {
  snapshot: object;
  signature: string;
}

export interface Payee {
  id: number;
  name: string;
  defaultCategoryId: number | null;
}

export interface SearchResults {
  transactions: Transaction[];
  hasMore: boolean;
}

export interface TransactionLine {
  categoryId: number | null;
  categoryName: string | null;
  amountCents: number;
  memo: string;
}

export interface LineInput {
  categoryId: number | null;
  amountCents: number;
  memo: string;
}

/** Either `categoryId` or, for a split, `lines`. */
export interface TransactionInput {
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  categoryId?: number | null;
  lines?: LineInput[];
  transferAccountId: number | null;
  flag?: FlagColor | null;
}

/** YNAB's frequencies; `never` means once. */
export type Frequency =
  | 'never'
  | 'daily'
  | 'weekly'
  | 'everyOtherWeek'
  | 'twiceAMonth'
  | 'every4Weeks'
  | 'monthly'
  | 'everyOtherMonth'
  | 'every3Months'
  | 'every4Months'
  | 'twiceAYear'
  | 'yearly'
  | 'everyOtherYear';

/** A transaction input plus how often it repeats; `date` is the first occurrence. */
export type ScheduleInput = TransactionInput & { frequency: Frequency };

export interface ScheduledTransaction {
  id: number;
  accountId: number;
  frequency: Frequency;
  nextDate: string;
  payee: string;
  memo: string;
  flag: FlagColor | null;
  amountCents: number;
  categoryId: number | null;
  categoryName: string | null;
  lines: LineInput[] | null;
  transferAccountId: number | null;
  transferAccountName: string | null;
}

export interface SpendingReport {
  totalCents: number;
  items: { label: string; spentCents: number }[];
}

export interface TrendsReport {
  months: { month: string; spentCents: number }[];
  averageCents: number;
}

export interface IncomeExpenseRow {
  label: string;
  byMonth: number[];
  totalCents: number;
}

export interface IncomeExpenseReport {
  months: string[];
  income: IncomeExpenseRow[];
  expenseGroups: (IncomeExpenseRow & { categories: IncomeExpenseRow[] })[];
  incomeByMonth: number[];
  expensesByMonth: number[];
  netByMonth: number[];
}

export interface NetWorthPoint {
  month: string;
  assetsCents: number;
  debtsCents: number;
  netWorthCents: number;
}

/** The fields a transaction form can start from: a transaction, or a schedule's next occurrence. */
export type TransactionDraft = Pick<
  Transaction,
  'date' | 'payee' | 'memo' | 'amountCents' | 'categoryId' | 'transferAccountId' | 'lines'
> & { flag?: Transaction['flag'] };

export interface Category {
  id: number;
  name: string;
  hidden: boolean;
}

export interface CategoryGroup<C extends Category = Category> {
  id: number;
  name: string;
  hidden: boolean;
  categories: C[];
}

export interface Categories {
  readyToAssignId: number;
  groups: CategoryGroup[];
}

export interface BudgetCategory extends Category {
  assignedCents: number;
  activityCents: number;
  availableCents: number;
  assignedLastMonthCents: number;
  spentLastMonthCents: number;
  averageAssignedCents: number;
  averageSpentCents: number;
  /** Scheduled money still to come this month; negative for outflows. */
  upcomingCents: number;
}

export interface AssignmentInput {
  categoryId: number;
  assignedCents: number;
}

export interface Budget {
  month: string;
  readyToAssignCents: number;
  uncategorized: { accountId: number; accountName: string; count: number }[];
  groups: CategoryGroup<BudgetCategory>[];
}

export interface YnabPlanSummary {
  id: string;
  name: string;
  lastModifiedOn: string | null;
}

export interface ImportAccount {
  name: string;
  ynabType: string;
  type: string;
  onBudget: boolean;
  closed: boolean;
  balanceCents: number;
}

export interface SkippedSchedule {
  payee: string;
  accountName: string;
  nextDate: string;
  reason: string;
}

/** What an import changes or leaves out; see the server's ImportNotes. */
export interface ImportNotes {
  paymentCategories: { name: string; assignedCents: number; availableCents: number }[];
  splitTransfers: number;
  startingDebtCents: number;
  uncategorized: number;
  recategorized: number;
  unpairedTransfers: number;
  unapproved: number;
  flagged: number;
  flagNames: { color: FlagColor; name: string }[];
  skippedSchedules: SkippedSchedule[];
  toFix: TransactionToFix[];
}

/** A transaction to look at after importing. */
export interface TransactionToFix {
  reason: 'uncategorized' | 'unpairedTransfer';
  date: string;
  accountName: string;
  payee: string;
  amountCents: number;
}

export interface ImportCounts {
  accounts: number;
  categoryGroups: number;
  categories: number;
  payees: number;
  transactions: number;
  scheduled: number;
  months: number;
}

export interface ImportPreview {
  planName: string;
  currency: string | null;
  accounts: ImportAccount[];
  counts: ImportCounts;
  notes: ImportNotes;
  problems: string[];
  fractionalAmounts: FractionalAmount[];
}

export interface FractionalAmount {
  kind: 'transaction' | 'scheduled' | 'assigned';
  /** A date, or a month (YYYY-MM) for an assignment. */
  date: string;
  accountName: string | null;
  name: string;
  milliunits: number;
}

export type ReadyToAssignPartKey =
  'paymentCategories' | 'startingDebt' | 'uncategorized' | 'creditOverspending' | 'unexplained';

export interface ImportReport {
  month: string;
  accounts: {
    name: string;
    ynabBalanceCents: number;
    balanceCents: number;
    ynabClearedCents: number;
    clearedCents: number;
    matches: boolean;
  }[];
  readyToAssign: {
    ynabCents: number;
    cents: number;
    parts: { key: ReadyToAssignPartKey; cents: number }[];
  };
  categoriesCompared: number;
  categoryDifferences: {
    groupName: string;
    name: string;
    ynabAvailableCents: number;
    availableCents: number;
    firstMonth: string;
  }[];
  counts: ImportCounts;
  notes: ImportNotes;
}

export type MoveDirection = 'up' | 'down';
type CategoryChanges = { name?: string; hidden?: boolean };

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    ...(body && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });

  if (!response.ok) {
    const error: { message?: string; code?: string } | null = await response
      .json()
      .catch(() => null);
    // A session that ended, such as by signing out on another device, goes to sign-in and back.
    if (error?.code === 'SIGNED_OUT') window.location.assign(signInPath());
    throw new ApiError(error?.message ?? 'Can’t reach the server.', response.status, error?.code);
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  session: () => request<{ signedIn: boolean; passwordSet: boolean }>('/auth/session'),
  login: (password: string) => request<void>('/auth/login', 'POST', { password }),
  logout: () => request<void>('/auth/logout', 'POST'),
  listAccounts: () => request<Account[]>('/accounts'),
  createAccount: (input: {
    name: string;
    type: string;
    startingBalanceCents: number;
    date: string;
  }) => request<Account>('/accounts', 'POST', input),
  updateAccount: (id: number, changes: { name?: string; type?: string }) =>
    request<void>(`/accounts/${id}`, 'PATCH', changes),
  closeAccount: (id: number, date: string) =>
    request<void>(`/accounts/${id}/close`, 'POST', { date }),
  reopenAccount: (id: number) => request<void>(`/accounts/${id}/reopen`, 'POST'),
  reconcileAccount: (id: number, bankBalanceCents: number, date: string) =>
    request<{ adjustmentCents: number }>(`/accounts/${id}/reconcile`, 'POST', {
      bankBalanceCents,
      date,
    }),
  deleteAccount: (id: number) => request<void>(`/accounts/${id}`, 'DELETE'),
  /** A page of an account's register, newest first, continuing after `before`. */
  listTransactions: (accountId: number, page: { limit: number; before?: number }) =>
    request<Transaction[]>(
      `/accounts/${accountId}/transactions?limit=${page.limit}${page.before ? `&before=${page.before}` : ''}`,
    ),
  createTransaction: (accountId: number, input: TransactionInput) =>
    request<void>(`/accounts/${accountId}/transactions`, 'POST', input),
  updateTransaction: (
    id: number,
    input: Partial<TransactionInput> & {
      cleared?: Exclude<ClearedStatus, 'reconciled'>;
      confirmReconciled?: boolean;
    },
  ) => request<void>(`/transactions/${id}`, 'PATCH', input),
  searchTransactions: (filters: URLSearchParams) =>
    request<SearchResults>(`/transactions?${filters}`),
  listPayees: () => request<Payee[]>('/payees'),
  listFlags: () => request<Flag[]>('/flags'),
  /** A blank name clears it. */
  renameFlag: (color: FlagColor, name: string) =>
    request<Flag[]>(`/flags/${color}`, 'PUT', { name }),
  listScheduled: (accountId: number) =>
    request<ScheduledTransaction[]>(`/accounts/${accountId}/scheduled`),
  createScheduled: (accountId: number, input: ScheduleInput) =>
    request<{ id: number; posted: number }>(`/accounts/${accountId}/scheduled`, 'POST', input),
  updateScheduled: (id: number, input: ScheduleInput) =>
    request<{ id: number; posted: number }>(`/scheduled/${id}`, 'PUT', input),
  deleteScheduled: (id: number) => request<void>(`/scheduled/${id}`, 'DELETE'),
  enterScheduledNow: (id: number) => request<void>(`/scheduled/${id}/enter-now`, 'POST'),
  skipScheduled: (id: number) => request<void>(`/scheduled/${id}/skip`, 'POST'),
  spendingReport: (range: URLSearchParams) => request<SpendingReport>(`/reports/spending?${range}`),
  trendsReport: (range: URLSearchParams) => request<TrendsReport>(`/reports/trends?${range}`),
  incomeExpenseReport: (range: URLSearchParams) =>
    request<IncomeExpenseReport>(`/reports/income-expense?${range}`),
  netWorthReport: (range: URLSearchParams) =>
    request<NetWorthPoint[]>(`/reports/net-worth?${range}`),
  /** The delete dialog is the warning for reconciled transactions, so the UI always confirms. */
  /** Returns what Undo needs to put the transaction back. */
  deleteTransaction: (id: number) =>
    request<{ undo: DeletedTransaction }>(`/transactions/${id}?confirmReconciled=true`, 'DELETE'),
  restoreTransaction: (undo: DeletedTransaction) =>
    request<{ restored: number[] }>('/transactions/restore', 'POST', undo),
  getBudget: (month: string, currentMonth: string) =>
    request<Budget>(`/budget?month=${month}&currentMonth=${currentMonth}`),
  setAssignment: (month: string, categoryId: number, assignedCents: number) =>
    request<void>(`/budget/${month}/categories/${categoryId}`, 'PUT', { assignedCents }),
  /** Null means Ready to Assign. */
  moveMoney: (
    month: string,
    move: { fromCategoryId: number | null; toCategoryId: number | null; amountCents: number },
  ) => request<void>(`/budget/${month}/move`, 'POST', move),
  setAssignments: (month: string, assignments: AssignmentInput[]) =>
    request<void>(`/budget/${month}/assignments`, 'POST', { assignments }),
  listCategories: () => request<Categories>('/categories'),
  createGroup: (name: string) => request<void>('/category-groups', 'POST', { name }),
  updateGroup: (id: number, changes: CategoryChanges) =>
    request<void>(`/category-groups/${id}`, 'PATCH', changes),
  moveGroup: (id: number, direction: MoveDirection) =>
    request<void>(`/category-groups/${id}/move`, 'POST', { direction }),
  deleteGroup: (id: number) => request<void>(`/category-groups/${id}`, 'DELETE'),
  createCategory: (groupId: number, name: string) =>
    request<void>('/categories', 'POST', { groupId, name }),
  updateCategory: (id: number, changes: CategoryChanges & { groupId?: number }) =>
    request<void>(`/categories/${id}`, 'PATCH', changes),
  moveCategory: (id: number, direction: MoveDirection) =>
    request<void>(`/categories/${id}/move`, 'POST', { direction }),
  deleteCategory: (id: number) => request<void>(`/categories/${id}`, 'DELETE'),
  approveTransactions: (ids: number[]) => request<void>('/transactions/approve', 'POST', { ids }),
  approveAll: (accountId: number) =>
    request<{ approved: number }>(`/accounts/${accountId}/approve-all`, 'POST'),
  unmatchTransaction: (id: number) => request<void>(`/transactions/${id}/unmatch`, 'POST'),
  listPending: (accountId: number) =>
    request<PendingTransaction[]>(`/accounts/${accountId}/pending`),
  setImportFrom: (bankAccountId: number, importFrom: string) =>
    request<BankConnection>(`/bank/accounts/${bankAccountId}/import-from`, 'PUT', { importFrom }),
  bankStatus: () => request<BankStatus>('/bank/status'),
  listBankConnections: () => request<BankConnection[]>('/bank/connections'),
  /** With a connection, Plaid's sign-in window opens to fix it. */
  createLinkToken: (connectionId?: number) =>
    request<{ linkToken: string }>(
      '/bank/link-token',
      'POST',
      connectionId ? { connectionId } : {},
    ),
  connectBank: (publicToken: string, institutionName: string | undefined) =>
    request<BankConnection>('/bank/connections', 'POST', {
      publicToken,
      ...(institutionName && { institutionName }),
    }),
  refreshBankConnection: (id: number) =>
    request<BankConnection>(`/bank/connections/${id}/refresh`, 'POST'),
  removeBankConnection: (id: number) => request<void>(`/bank/connections/${id}`, 'DELETE'),
  /** Null unlinks it. */
  linkBankAccount: (bankAccountId: number, accountId: number | null) =>
    request<BankConnection>(`/bank/accounts/${bankAccountId}/link`, 'PUT', { accountId }),
  createAccountFromBank: (bankAccountId: number, input: { name: string; type: string }) =>
    request<BankConnection & { accountId: number }>(
      `/bank/accounts/${bankAccountId}/create-account`,
      'POST',
      input,
    ),
  importStatus: () => request<{ canImport: boolean }>('/import/status'),
  listYnabPlans: (token: string) =>
    request<{ plans: YnabPlanSummary[] }>('/import/ynab/plans', 'POST', { token }),
  previewYnabImport: (token: string, planId: string) =>
    request<ImportPreview>('/import/ynab/preview', 'POST', { token, planId }),
  importYnabPlan: (token: string, planId: string) =>
    request<ImportReport>('/import/ynab', 'POST', { token, planId }),
};
