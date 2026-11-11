export interface Account {
  id: number;
  name: string;
  type: string;
  onBudget: boolean;
  closed: boolean;
  balanceCents: number;
  clearedBalanceCents: number;
  lastReconciledAt: string | null;
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

export interface Transaction {
  id: number;
  accountId: number;
  accountName: string;
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  cleared: ClearedStatus;
  categoryId: number | null;
  categoryName: string | null;
  hasCategoryLine: boolean;
  transferAccountId: number | null;
  transferAccountName: string | null;
  /** One line normally, or several for a split. */
  lines: TransactionLine[];
  /** Only in a single account's register. */
  runningBalanceCents?: number;
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
  amountCents: number;
  categoryId: number | null;
  categoryName: string | null;
  lines: LineInput[] | null;
  transferAccountId: number | null;
  transferAccountName: string | null;
}

/** The fields a transaction form can start from: a transaction, or a schedule's next occurrence. */
export type TransactionDraft = Pick<
  Transaction,
  'date' | 'payee' | 'memo' | 'amountCents' | 'categoryId' | 'transferAccountId' | 'lines'
>;

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
    throw new ApiError(error?.message ?? 'Can’t reach the server.', response.status, error?.code);
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
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
  listTransactions: (accountId: number) =>
    request<Transaction[]>(`/accounts/${accountId}/transactions`),
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
  listScheduled: (accountId: number) =>
    request<ScheduledTransaction[]>(`/accounts/${accountId}/scheduled`),
  createScheduled: (accountId: number, input: ScheduleInput) =>
    request<{ id: number; posted: number }>(`/accounts/${accountId}/scheduled`, 'POST', input),
  updateScheduled: (id: number, input: ScheduleInput) =>
    request<{ id: number; posted: number }>(`/scheduled/${id}`, 'PUT', input),
  deleteScheduled: (id: number) => request<void>(`/scheduled/${id}`, 'DELETE'),
  enterScheduledNow: (id: number) => request<void>(`/scheduled/${id}/enter-now`, 'POST'),
  skipScheduled: (id: number) => request<void>(`/scheduled/${id}/skip`, 'POST'),
  /** The delete dialog is the warning for reconciled transactions, so the UI always confirms. */
  deleteTransaction: (id: number) =>
    request<void>(`/transactions/${id}?confirmReconciled=true`, 'DELETE'),
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
};
