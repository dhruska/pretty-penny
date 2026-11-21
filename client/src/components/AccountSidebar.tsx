import { api, type Account } from '@/api';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { NavLink } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { useState } from 'react';
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
          'flex items-baseline justify-between gap-3 rounded-md px-2 py-2.5 text-sm md:py-1.5 hover:bg-muted',
          isActive && 'bg-muted font-medium',
          account.closed && 'text-muted-foreground',
        )
      }
    >
      {/* Long names shorten with "…", keeping the balance on one line beside them. */}
      <span className="min-w-0 truncate" title={account.name}>
        {account.name}
      </span>
      <Money cents={account.balanceCents} className="shrink-0" />
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

/** As in YNAB, adding an account is rare, so it opens in a dialog rather than filling the sidebar. */
function AddAccountButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="mt-4 w-full">
          Add account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader title="Add an account" />
        <AddAccountForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** The page links, accounts and balances, shown in the laptop sidebar and the phone menu. */
export function SidebarContents() {
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const all = accounts.data ?? [];
  const open = all.filter((account) => !account.closed);
  const closed = all.filter((account) => account.closed);

  return (
    <>
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          cn(
            'mb-1 block rounded-md px-2 py-2.5 text-sm md:py-1.5 hover:bg-muted',
            isActive && 'bg-muted font-medium',
          )
        }
      >
        Budget
      </NavLink>
      <NavLink
        to="/transactions"
        className={({ isActive }) =>
          cn(
            'mb-1 block rounded-md px-2 py-2.5 text-sm md:py-1.5 hover:bg-muted',
            isActive && 'bg-muted font-medium',
          )
        }
      >
        All transactions
      </NavLink>
      <NavLink
        to="/reports"
        className={({ isActive }) =>
          cn(
            'mb-4 block rounded-md px-2 py-2.5 text-sm md:py-1.5 hover:bg-muted',
            isActive && 'bg-muted font-medium',
          )
        }
      >
        Reports
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

      <AddAccountButton />

      <NavLink
        to="/import"
        className={({ isActive }) =>
          cn(
            'mt-3 block rounded-md px-2 py-2.5 text-sm md:py-1.5 text-muted-foreground hover:bg-muted',
            isActive && 'bg-muted font-medium text-foreground',
          )
        }
      >
        Import from YNAB
      </NavLink>
      <button
        type="button"
        onClick={async () => {
          await api.logout();
          window.location.assign('/login');
        }}
        className="mt-1 block w-full cursor-pointer rounded-md px-2 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted md:py-1.5"
      >
        Sign out
      </button>
    </>
  );
}

export function AccountSidebar() {
  return (
    <aside aria-label="Accounts" className="min-h-svh w-72 shrink-0 border-r bg-card p-4">
      <h1 className="mb-4 text-lg font-semibold">Pretty Penny</h1>
      <SidebarContents />
    </aside>
  );
}
