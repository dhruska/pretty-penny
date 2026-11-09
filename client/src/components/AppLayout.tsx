import { Outlet } from 'react-router';
import { AccountSidebar } from './AccountSidebar';

export function AppLayout() {
  return (
    <div className="min-h-svh md:flex">
      <AccountSidebar />
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
