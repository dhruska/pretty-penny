import { api } from '@/api';
import { signInPath } from '@/lib/signIn';
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { currentMonth } from '@/lib/months';
import { useIsPhone } from '@/lib/useIsPhone';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { AccountSidebar, SidebarContents } from './AccountSidebar';
import { Money } from './Money';

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5">
      <path
        d="M3 5h14M3 10h14M3 15h14"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** On phones, a bar with the app name, Ready to Assign, and a menu holding the sidebar. */
function PhoneTopBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  // The menu closes whenever the page changes: following a link, or adding an account.
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }
  const month = currentMonth();
  // Shares the budget page's query, so both show the same figure.
  const budget = useQuery({
    queryKey: ['budget', month, month],
    queryFn: () => api.getBudget(month, month),
  });
  // The budget page shows Ready to Assign itself.
  const readyToAssign = pathname === '/' ? undefined : budget.data?.readyToAssignCents;

  return (
    <header className="sticky top-0 z-40 flex items-center gap-2 border-b bg-card px-2 py-1">
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogTrigger
          aria-label="Menu"
          className="inline-flex size-10 cursor-pointer items-center justify-center rounded-md hover:bg-muted"
        >
          <MenuIcon />
        </DialogTrigger>
        <DialogContent placement="left">
          <DialogHeader title="Pretty Penny" />
          {/* A link to the page already showing doesn't change the page, so close on any link too. */}
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('a')) setMenuOpen(false);
            }}
          >
            <SidebarContents />
          </div>
        </DialogContent>
      </Dialog>
      <Link to="/" className="min-w-0 flex-1 truncate font-semibold">
        Pretty Penny
      </Link>
      {readyToAssign !== undefined && (
        <Link
          to="/"
          aria-label="Ready to Assign"
          className={cn(
            'flex flex-col items-end rounded-md px-2 py-0.5 leading-tight',
            readyToAssign < 0 ? 'bg-negative/10' : 'bg-positive/10',
          )}
        >
          <Money
            cents={readyToAssign}
            className={cn('text-sm font-semibold', readyToAssign >= 0 && 'text-positive')}
          />
          <span className="text-[0.65rem] text-muted-foreground">Ready to Assign</span>
        </Link>
      )}
    </header>
  );
}

export function AppLayout() {
  const isPhone = useIsPhone();
  const session = useQuery({ queryKey: ['session'], queryFn: api.session });

  if (session.isPending) return null;
  if (session.isError) {
    return <p className="p-6 text-negative">{session.error.message}</p>;
  }
  if (!session.data?.signedIn) return <Navigate to={signInPath()} replace />;

  return (
    <div className="min-h-svh md:flex">
      {isPhone ? <PhoneTopBar /> : <AccountSidebar />}
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
