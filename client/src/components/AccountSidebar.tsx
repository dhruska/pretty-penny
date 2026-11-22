import { api, type Account } from '@/api';
import { Skeleton } from '@/components/ui/skeleton';
import { registerQuery } from '@/lib/queries';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import {
  ChartColumn,
  Import,
  Landmark,
  List,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Sun,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { useState } from 'react';
import { AddAccountForm } from './AddAccountForm';
import { PennyMark } from './PennyMark';
import { Money } from './Money';

const sumBalances = (accounts: Account[]) =>
  accounts.reduce((sum, account) => sum + account.balanceCents, 0);

function AccountLink({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  // Starts loading the register on hover or press, so it's usually ready when the page opens.
  const preload = () => void queryClient.prefetchInfiniteQuery(registerQuery(account.id));
  return (
    <NavLink
      to={`/accounts/${account.id}`}
      onMouseEnter={preload}
      onFocus={preload}
      onTouchStart={preload}
      className={({ isActive }) =>
        cn(
          'flex items-baseline justify-between gap-3 rounded-lg px-2.5 py-2.5 text-sm md:py-1.5 hover:bg-muted',
          isActive && 'bg-accent-soft font-semibold text-accent-ink hover:bg-accent-soft',
          account.closed && !isActive && 'text-muted-foreground',
        )
      }
    >
      {/* Long names shorten with "…", keeping the balance on one line beside them. */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate" title={account.name}>
          {account.name}
        </span>
        {account.unapprovedCount > 0 && (
          <span
            role="img"
            aria-label={`${account.unapprovedCount} to review`}
            title={`${account.unapprovedCount} to review`}
            className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums"
          >
            {account.unapprovedCount}
          </span>
        )}
        {account.bank && account.bank.status !== 'ok' && (
          <TriangleAlert
            role="img"
            aria-label="Bank connection needs fixing"
            className="size-3.5 shrink-0 self-center text-negative"
            strokeWidth={2}
          />
        )}
      </span>
      <Money cents={account.balanceCents} className="shrink-0 font-normal" />
    </NavLink>
  );
}

function AccountSection({ title, accounts }: { title: string; accounts: Account[] }) {
  if (accounts.length === 0) return null;

  return (
    <section aria-label={`${title} accounts`} className="mb-4">
      <h2 className="flex items-baseline justify-between px-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
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

const THEMES: { value: ThemeChoice; label: string; Icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/** A page link with its icon, highlighted in copper when it's the current page. */
function PageLink({
  to,
  Icon,
  children,
  end,
  quiet = false,
}: {
  to: string;
  Icon: LucideIcon;
  children: string;
  end?: boolean;
  quiet?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm hover:bg-muted md:py-1.5',
          quiet && 'text-muted-foreground',
          isActive && 'bg-accent-soft font-semibold text-accent-ink hover:bg-accent-soft',
        )
      }
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
      {children}
    </NavLink>
  );
}

/** Light, dark, or follow the device, remembered on this device. */
function ThemeSwitch() {
  const [choice, choose] = useTheme();
  return (
    <div role="group" aria-label="Theme" className="mt-4 flex rounded-lg bg-muted p-0.5 text-xs">
      {THEMES.map((theme) => (
        <button
          key={theme.value}
          type="button"
          aria-pressed={choice === theme.value}
          onClick={() => choose(theme.value)}
          className={cn(
            'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground max-md:py-2.5',
            choice === theme.value && 'bg-card font-medium text-foreground shadow-sm',
          )}
        >
          <theme.Icon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          {theme.label}
        </button>
      ))}
    </div>
  );
}

/** As in YNAB, adding an account is rare, so it opens in a dialog rather than filling the sidebar. */
export function AddAccountButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={className ?? 'mt-1 w-full justify-start gap-2.5 px-2.5'}
        >
          <Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
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
      <nav aria-label="Pages" className="mb-5 space-y-0.5">
        <PageLink to="/" end Icon={Wallet}>
          Budget
        </PageLink>
        <PageLink to="/transactions" Icon={List}>
          All transactions
        </PageLink>
        <PageLink to="/reports" Icon={ChartColumn}>
          Reports
        </PageLink>
      </nav>

      {accounts.isError && <p className="text-sm text-negative">{accounts.error.message}</p>}
      {accounts.isPending && (
        <div role="status" aria-label="Loading accounts" className="space-y-2 px-2 py-1">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex justify-between gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      )}

      <AccountSection title="Budget" accounts={open.filter((account) => account.onBudget)} />
      <AccountSection title="Tracking" accounts={open.filter((account) => !account.onBudget)} />

      {all.length > 0 && (
        <div className="mb-3 flex items-baseline justify-between border-t px-2.5 pt-3 text-sm font-semibold">
          <span>Net worth</span>
          <Money cents={sumBalances(all)} />
        </div>
      )}

      {closed.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
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

      <div className="mt-6 space-y-0.5 border-t pt-3">
        <PageLink to="/bank" Icon={Landmark} quiet>
          Bank connections
        </PageLink>
        <PageLink to="/import" Icon={Import} quiet>
          Import from YNAB
        </PageLink>
        <button
          type="button"
          onClick={async () => {
            await api.logout();
            window.location.assign('/login');
          }}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted md:py-1.5"
        >
          <LogOut aria-hidden="true" className="size-4" strokeWidth={1.75} />
          Sign out
        </button>
      </div>
      <ThemeSwitch />
    </>
  );
}

export function AccountSidebar() {
  return (
    <aside
      aria-label="Accounts"
      className="min-h-svh w-68 shrink-0 border-r bg-sidebar px-3.5 py-5"
    >
      <h1 className="mb-6 flex items-center gap-2.5 px-2.5 text-base font-bold tracking-tight">
        <PennyMark />
        Pretty Penny
      </h1>
      <SidebarContents />
    </aside>
  );
}
