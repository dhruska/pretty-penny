import { api } from '@/api';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { NavLink } from 'react-router';
import { AddAccountForm } from './AddAccountForm';
import { Money } from './Money';

export function AccountSidebar() {
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const total = accounts.data?.reduce((sum, account) => sum + account.balanceCents, 0) ?? 0;

  return (
    <aside
      aria-label="Accounts"
      className="shrink-0 border-b bg-card p-4 md:min-h-svh md:w-72 md:border-r md:border-b-0"
    >
      <h1 className="mb-4 text-lg font-semibold">Pretty Penny</h1>

      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          cn(
            'mb-4 block rounded-md px-2 py-1.5 text-sm hover:bg-muted',
            isActive && 'bg-muted font-medium',
          )
        }
      >
        Budget
      </NavLink>

      {accounts.isError && <p className="text-sm text-negative">{accounts.error.message}</p>}

      <nav className="space-y-1">
        {accounts.data?.map((account) => (
          <NavLink
            key={account.id}
            to={`/accounts/${account.id}`}
            className={({ isActive }) =>
              cn(
                'flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted',
                isActive && 'bg-muted font-medium',
              )
            }
          >
            <span className="truncate">{account.name}</span>
            <Money cents={account.balanceCents} />
          </NavLink>
        ))}
      </nav>

      {accounts.data && accounts.data.length > 0 && (
        <div className="mt-2 flex items-baseline justify-between border-t px-2 pt-2 text-sm font-medium">
          <span>Total</span>
          <Money cents={total} />
        </div>
      )}

      <AddAccountForm />
    </aside>
  );
}
