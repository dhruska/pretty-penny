import { api } from '@/api';
import { infiniteQueryOptions, type QueryClient, type QueryKey } from '@tanstack/react-query';

/** Transactions per page of a register; the next page loads as you scroll near the end. */
export const REGISTER_PAGE_SIZE = 200;

/** An account's register, newest first, a page at a time. */
export const registerQuery = (accountId: number) =>
  infiniteQueryOptions({
    queryKey: ['transactions', accountId],
    queryFn: ({ pageParam }) =>
      api.listTransactions(accountId, { limit: REGISTER_PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length === REGISTER_PAGE_SIZE ? lastPage.at(-1)!.id : undefined,
  });

/**
 * What each kind of change affects. Only these are refreshed after a change, in the background,
 * instead of everything.
 */
export const AFFECTS = {
  /** Adding, editing or deleting a transaction, or entering a scheduled one. */
  transactions: [
    ['transactions'],
    ['pending'],
    ['accounts'],
    ['budget'],
    ['search'],
    ['scheduled'],
    ['payees'],
    ['report'],
  ],
  /** Assigning or moving money. */
  budget: [['budget']],
  /** Adding, renaming, hiding or moving categories. */
  categories: [['categories'], ['budget'], ['transactions'], ['search'], ['report']],
  /** Adding, renaming, closing or reopening an account. */
  accounts: [
    ['accounts'],
    ['transactions'],
    ['budget'],
    ['search'],
    ['scheduled'],
    ['report'],
    ['import-status'],
    ['bank-connections'],
  ],
  /** Connecting, fixing or removing a bank, or linking its accounts. */
  bank: [['bank-connections'], ['accounts']],
  /** Importing from a bank, or approving, rejecting or unmatching what it imported. */
  imports: [
    ['bank-connections'],
    ['transactions'],
    ['pending'],
    ['accounts'],
    ['budget'],
    ['search'],
    ['scheduled'],
    ['payees'],
    ['report'],
  ],
  /** Changing a schedule without posting it. */
  schedules: [['scheduled'], ['budget']],
  flags: [['flags']],
  /** Toggling cleared or changing a flag. */
  quickChanges: [['transactions'], ['search'], ['accounts']],
} satisfies Record<string, QueryKey[]>;

/** Refreshes what a change affects, without waiting for it. */
export function refresh(queryClient: QueryClient, ...kinds: (keyof typeof AFFECTS)[]) {
  for (const kind of kinds) {
    for (const queryKey of AFFECTS[kind]) void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Updates cached data right away, before the server answers. Every cached query whose key
 * starts with one of the given keys is updated. Returns a function that puts it all back,
 * for when the server refuses the change.
 */
export async function updateNow(
  queryClient: QueryClient,
  changes: { queryKey: QueryKey; update: (data: never) => unknown }[],
) {
  const saved: [QueryKey, unknown][] = [];
  for (const { queryKey, update } of changes) {
    await queryClient.cancelQueries({ queryKey });
    for (const [key, data] of queryClient.getQueriesData({ queryKey })) {
      if (data === undefined) continue;
      saved.push([key, data]);
      queryClient.setQueryData(key, update(data as never));
    }
  }
  return () => {
    for (const [key, data] of saved) queryClient.setQueryData(key, data);
  };
}
