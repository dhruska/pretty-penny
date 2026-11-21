import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { refresh, registerQuery, REGISTER_PAGE_SIZE, updateNow } from './queries';

describe('register pages', () => {
  it('fetch a page of the register, after the given transaction', async () => {
    const list = vi.spyOn(api, 'listTransactions').mockResolvedValue([]);
    const { queryFn } = registerQuery(7);
    await queryFn!({ pageParam: 42 } as never);
    expect(list).toHaveBeenCalledWith(7, { limit: REGISTER_PAGE_SIZE, before: 42 });
    list.mockRestore();
  });

  it('asks for the next page only after a full one, starting after its last transaction', () => {
    const { getNextPageParam } = registerQuery(1);
    const full = Array.from({ length: REGISTER_PAGE_SIZE }, (_, index) => ({ id: 500 - index }));
    expect(getNextPageParam(full as never, [], undefined, [])).toBe(500 - REGISTER_PAGE_SIZE + 1);
    expect(getNextPageParam([{ id: 3 }] as never, [], undefined, [])).toBeUndefined();
  });
});

describe('updating cached data', () => {
  it('updates every matching query at once and can put it all back', async () => {
    const client = new QueryClient();
    client.setQueryData(['budget', '2026-11', '2026-11'], { value: 1 });
    client.setQueryData(['budget', '2026-12', '2026-11'], { value: 2 });
    client.setQueryData(['accounts'], { value: 3 });

    const undo = await updateNow(client, [
      { queryKey: ['budget'], update: (data: { value: number }) => ({ value: data.value * 10 }) },
      { queryKey: ['payees'], update: () => 'never called' },
    ]);
    expect(client.getQueryData(['budget', '2026-11', '2026-11'])).toEqual({ value: 10 });
    expect(client.getQueryData(['budget', '2026-12', '2026-11'])).toEqual({ value: 20 });
    expect(client.getQueryData(['accounts'])).toEqual({ value: 3 });

    undo();
    expect(client.getQueryData(['budget', '2026-11', '2026-11'])).toEqual({ value: 1 });
  });

  it('refreshes only what a kind of change affects', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    refresh(client, 'budget', 'flags');
    expect(invalidate.mock.calls.map(([filters]) => filters!.queryKey)).toEqual([
      ['budget'],
      ['flags'],
    ]);
  });
});
