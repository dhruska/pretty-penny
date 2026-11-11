import { api, type Account } from '@/api';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { NavLink } from 'react-router';
import { AddAccountForm } from './AddAccountForm';
import { Money } from './Money';

const sumBalances = (accounts: Account[]) =>
  accounts.reduce((sum, account) => sum + account.balanceCents, 0);

function AccountLink({ account }: { account: Account }) {
  return (
    <NavLink
      to={`/accounts/${account.id}`}
      className={({ isActive }) =>
        cn(
          'flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted',
          isActive && 'bg-muted font-medium',
          account.closed && 'text-muted-foreground',
        )
      }
    >
      <span className="truncate">{account.name}</span>
      <Money cents={account.balanceCents} />
    </NavLink>
  );
}

function AccountSection({ title, accounts }: { title: string; accounts: Account[] }) {
  if (accounts.length === 0) return null;

  return (
    <section aria-label={`${title} accounts`} className="mb-3">
      <h2 className="flex items-baseline justify-between px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <span>{title}</span>
        <Money cents={sumBalances(accounts)} />
      </h2>
      <nav className="space-y-0.5">
        {accounts.map((account) => (
          <AccountLink key={account.id} account={account} />
        ))}
      </nav>
    </section>
  );
}

export function AccountSidebar() {
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const all = accounts.data ?? [];
  const open = all.filter((account) => !account.closed);
  const closed = all.filter((account) => account.closed);

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

      <AccountSection title="Budget" accounts={open.filter((account) => account.onBudget)} />
      <AccountSection title="Tracking" accounts={open.filter((account) => !account.onBudget)} />

      {all.length > 0 && (
        <div className="flex items-baseline justify-between border-t px-2 pt-2 text-sm font-medium">
          <span>Net worth</span>
          <Money cents={sumBalances(all)} />
        </div>
      )}

      {closed.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Closed ({closed.length})
          </summary>
          <nav aria-label="Closed accounts" className="mt-1 space-y-0.5">
            {closed.map((account) => (
              <AccountLink key={account.id} account={account} />
            ))}
          </nav>
        </details>
      )}

      <AddAccountForm />
    </aside>
  );
}
