import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resetDb } from './reset-db';

test.beforeEach(() => resetDb());

function thisMonthDate(day: number) {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function post<T>(request: APIRequestContext, url: string, data: object) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

/** Checking with a paycheck, groceries and rent this month, all dated the 1st so any day works. */
async function seed(request: APIRequestContext) {
  const checking = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Checking',
    startingBalanceCents: 1_000_00,
    date: thisMonthDate(1),
  });
  const everyday = await post<{ id: number }>(request, '/api/category-groups', {
    name: 'Everyday',
  });
  const bills = await post<{ id: number }>(request, '/api/category-groups', { name: 'Bills' });
  const groceries = await post<{ id: number }>(request, '/api/categories', {
    groupId: everyday.id,
    name: 'Groceries',
  });
  const rent = await post<{ id: number }>(request, '/api/categories', {
    groupId: bills.id,
    name: 'Rent',
  });
  const { readyToAssignId } = await (await request.get('/api/categories')).json();
  const add = (fields: object) =>
    post(request, `/api/accounts/${checking.id}/transactions`, {
      date: thisMonthDate(1),
      ...fields,
    });
  await add({ payee: 'Acme Payroll', amountCents: 2_500_00, categoryId: readyToAssignId });
  await add({ payee: 'Corner Market', amountCents: -150_00, categoryId: groceries.id });
  await add({ payee: 'Landlord', amountCents: -850_00, categoryId: rent.id });
}

function report(page: Page, name: string) {
  return page.getByRole('region', { name });
}

test('shows spending by category, group and payee', async ({ page, request }) => {
  await seed(request);
  await page.goto('/');
  await page.getByRole('link', { name: 'Reports' }).click();

  const breakdown = report(page, 'Spending breakdown');
  await expect(breakdown).toContainText('Total spending $1,000.00');
  await expect(breakdown.getByRole('row').nth(1)).toContainText('Rent');
  await expect(breakdown.getByRole('row').nth(1)).toContainText('85.0%');

  await page.getByLabel('Group by').selectOption({ label: 'Category group' });
  await expect(breakdown.getByRole('row').nth(1)).toContainText('Bills');

  await page.getByLabel('Group by').selectOption({ label: 'Payee' });
  await expect(breakdown.getByRole('row').nth(2)).toContainText('Corner Market');
});

test('shows trends, income v expense and net worth', async ({ page, request }) => {
  await seed(request);
  await page.goto('/reports');
  await page.getByLabel('Dates').selectOption({ label: 'This month' });

  await page.getByRole('tab', { name: 'Spending trends' }).click();
  await expect(report(page, 'Spending trends')).toContainText('averaging $1,000.00');
  await page.getByLabel('Show').selectOption({ label: 'Groceries' });
  await expect(report(page, 'Spending trends')).toContainText('Groceries, averaging $150.00');

  await page.getByRole('tab', { name: 'Income v expense' }).click();
  const incomeExpense = report(page, 'Income v expense');
  await expect(incomeExpense.getByRole('row', { name: /Acme Payroll/ })).toContainText('$2,500.00');
  await expect(incomeExpense.getByRole('row', { name: /Starting Balance/ })).toHaveCount(0);
  await expect(incomeExpense.getByRole('row', { name: /Net income/ })).toContainText('$1,500.00');

  await page.getByRole('tab', { name: 'Net worth' }).click();
  await expect(report(page, 'Net worth')).toContainText('$2,500.00 at the end of');
});

test('downloads both exports as CSV', async ({ page, request }) => {
  await seed(request);
  await page.goto('/reports');

  const [transactions] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Export transactions' }).click(),
  ]);
  expect(transactions.suggestedFilename()).toMatch(
    /^pretty-penny-transactions-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const transactionsCsv = await readFile((await transactions.path())!, 'utf8');
  expect(transactionsCsv).toContain('"Corner Market","Everyday: Groceries"');

  const [budget] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Export budget' }).click(),
  ]);
  expect(budget.suggestedFilename()).toMatch(/^pretty-penny-budget-.*\.csv$/);
  expect(await readFile((await budget.path())!, 'utf8')).toContain('"Bills: Rent"');
});
