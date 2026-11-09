export interface Account {
  id: number;
  name: string;
  balanceCents: number;
}

export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  runningBalanceCents: number;
}

export interface TransactionInput {
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
}

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
  createAccount: (input: { name: string; startingBalanceCents: number; date: string }) =>
    request<Account>('/accounts', 'POST', input),
  renameAccount: (id: number, name: string) => request<void>(`/accounts/${id}`, 'PATCH', { name }),
  deleteAccount: (id: number) => request<void>(`/accounts/${id}`, 'DELETE'),
  listTransactions: (accountId: number) =>
    request<Transaction[]>(`/accounts/${accountId}/transactions`),
  createTransaction: (accountId: number, input: TransactionInput) =>
    request<void>(`/accounts/${accountId}/transactions`, 'POST', input),
  updateTransaction: (id: number, input: TransactionInput) =>
    request<void>(`/transactions/${id}`, 'PATCH', input),
  deleteTransaction: (id: number) => request<void>(`/transactions/${id}`, 'DELETE'),
};
