import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import './index.css';
import { AccountPage } from './pages/AccountPage';
import { AllTransactionsPage } from './pages/AllTransactionsPage';
import { BudgetPage } from './pages/BudgetPage';

// Reports carry the charting library, so they load only when opened.
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })),
);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<BudgetPage />} />
            <Route path="accounts/:id" element={<AccountPage />} />
            <Route path="transactions" element={<AllTransactionsPage />} />
            <Route
              path="reports"
              element={
                <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
                  <ReportsPage />
                </Suspense>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
