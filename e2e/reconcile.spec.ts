import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
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

/** A checking account with $1,000 and a cleared $30 purchase, so the cleared balance is $970. */
async function setUp(request: APIRequestContext) {
  const checking = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Checking',
    startingBalanceCents: 1_000_00,
    date: thisMonthDate(1),
  });
  const group = await post<{ id: number }>(request, '/api/category-groups', { name: 'Everyday' });
  await post(request, '/api/categories', { groupId: group.id, name: 'Groceries' });
  await post(request, `/api/accounts/${checking.id}/transactions`, {
    date: thisMonthDate(2),
    payee: 'Corner Market',
    amountCents: -30_00,
    cleared: 'cleared',
  });
  return checking;
}

function row(page: Page, text: string) {
  return page.getByRole('row').filter({ hasText: text });
}

test('reconciles when the cleared balance matches the bank', async ({ page, request }) => {
  const checking = await setUp(request);
  await page.goto(`/accounts/${checking.id}`);
  await expect(page.getByText('Not reconciled yet')).toBeVisible();

  await page.getByRole('button', { name: 'Reconcile' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Reconcile Checking' });
  await expect(dialog).toContainText('$970.00');
  await dialog.getByRole('button', { name: 'Yes' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Last reconciled/)).toBeVisible();
  await expect(row(page, 'Corner Market').getByRole('img', { name: 'Reconciled' })).toBeVisible();
});

test('adds an adjustment when the bank balance differs', async ({ page, request }) => {
  const checking = await setUp(request);
  await page.goto(`/accounts/${checking.id}`);

  await page.getByRole('button', { name: 'Reconcile' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Reconcile Checking' });
  await dialog.getByRole('button', { name: 'No' }).click();
  await dialog.getByLabel('Bank balance').fill('960');
  await expect(dialog.getByLabel('Difference')).toContainText('-$10.00');
  await dialog.getByRole('button', { name: 'Create adjustment and finish' }).click();

  await expect(row(page, 'Reconciliation Balance Adjustment')).toContainText('$10.00');
  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('Cleared $960.00');

  await page.getByRole('link', { name: 'Budget' }).click();
  await expect(page.getByRole('region', { name: 'Ready to Assign' })).toContainText('$990.00');
});

test('asks before changing a reconciled amount or category, but not its memo', async ({
  page,
  request,
}) => {
  const checking = await setUp(request);
  await request.post(`/api/accounts/${checking.id}/reconcile`, {
    data: { bankBalanceCents: 970_00, date: thisMonthDate(3) },
  });
  await page.goto(`/accounts/${checking.id}`);

  await row(page, 'Corner Market').getByRole('button', { name: 'Edit' }).click();
  let form = page.getByRole('form', { name: 'Edit transaction' });
  await form.getByLabel('Memo').fill('weekly shop');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(row(page, 'Corner Market')).toContainText('weekly shop');

  await row(page, 'Corner Market').getByRole('button', { name: 'Edit' }).click();
  form = page.getByRole('form', { name: 'Edit transaction' });
  await form.getByLabel('Category', { exact: true }).selectOption({ label: 'Groceries' });
  await form.getByRole('button', { name: 'Save' }).click();
  const warning = page.getByRole('alertdialog', { name: 'This transaction is reconciled' });
  await warning.getByRole('button', { name: 'Cancel' }).click();
  await expect(form.getByText('Not saved')).toBeVisible();

  await form.getByLabel('Outflow').fill('35');
  await form.getByRole('button', { name: 'Save' }).click();
  await warning.getByRole('button', { name: 'Save anyway' }).click();
  await expect(row(page, 'Corner Market')).toContainText('$35.00');
  await expect(row(page, 'Corner Market')).toContainText('Groceries');
  await expect(row(page, 'Corner Market').getByRole('img', { name: 'Reconciled' })).toBeVisible();
});
