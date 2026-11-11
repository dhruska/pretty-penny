export interface Account {
  id: number;
  name: string;
  type: string;
  onBudget: boolean;
  closed: boolean;
  balanceCents: number;
}

export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  categoryId: number | null;
  categoryName: string | null;
  hasCategoryLine: boolean;
  transferAccountId: number | null;
  transferAccountName: string | null;
  runningBalanceCents: number;
}

export interface TransactionInput {
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  categoryId: number | null;
  transferAccountId: number | null;
}

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
    const error: { message?: string } | null = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'Can’t reach the server.');
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
  deleteAccount: (id: number) => request<void>(`/accounts/${id}`, 'DELETE'),
  listTransactions: (accountId: number) =>
    request<Transaction[]>(`/accounts/${accountId}/transactions`),
  createTransaction: (accountId: number, input: TransactionInput) =>
    request<void>(`/accounts/${accountId}/transactions`, 'POST', input),
  updateTransaction: (id: number, input: TransactionInput) =>
    request<void>(`/transactions/${id}`, 'PATCH', input),
  deleteTransaction: (id: number) => request<void>(`/transactions/${id}`, 'DELETE'),
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
