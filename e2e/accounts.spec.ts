import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resetDb } from './reset-db';

test.beforeEach(() => resetDb());

function sidebarAccount(page: Page, name: string) {
  return page.getByRole('complementary', { name: 'Accounts' }).getByRole('link', { name });
}

function row(page: Page, text: string) {
  return page.getByRole('row').filter({ hasText: text });
}

async function createAccount(page: Page, name: string, type: string, startingBalance = '') {
  await page.getByLabel('Account name').fill(name);
  await page.getByLabel('Account type', { exact: true }).selectOption({ label: type });
  await page.getByLabel('Starting balance').fill(startingBalance);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function createCategory(request: APIRequestContext, name: string) {
  const group = await (
    await request.post('/api/category-groups', { data: { name: 'Everyday' } })
  ).json();
  await request.post('/api/categories', { data: { groupId: group.id, name } });
}

async function addTransaction(
  page: Page,
  fields: {
    payee?: string;
    transfer?: string;
    category?: string;
    outflow?: string;
    inflow?: string;
  },
) {
  const form = page.getByRole('form', { name: 'Add transaction' });
  if (fields.transfer) await form.getByLabel('Transfer').selectOption({ label: fields.transfer });
  if (fields.payee) await form.getByLabel('Payee').fill(fields.payee);
  if (fields.category) await form.getByLabel('Category').selectOption({ label: fields.category });
  if (fields.outflow) await form.getByLabel('Outflow').fill(fields.outflow);
  if (fields.inflow) await form.getByLabel('Inflow').fill(fields.inflow);
  await form.getByRole('button', { name: 'Add transaction' }).click();
}

test('pays a credit card by transfer without changing the budget', async ({ page, request }) => {
  await createCategory(request, 'Groceries');
  await page.goto('/');
  await createAccount(page, 'Checking', 'Checking', '1,000');
  await createAccount(page, 'Card', 'Credit Card');

  await addTransaction(page, { payee: 'Market', category: 'Groceries', outflow: '40' });
  await expect(sidebarAccount(page, 'Card')).toContainText('-$40.00');

  await sidebarAccount(page, 'Checking').click();
  await addTransaction(page, { transfer: 'Card', outflow: '40' });
  await expect(row(page, 'Transfer: Card')).toContainText('$40.00');
  await expect(sidebarAccount(page, 'Card')).toContainText('$0.00');
  await expect(sidebarAccount(page, 'Checking')).toContainText('$960.00');

  await sidebarAccount(page, 'Card').click();
  await expect(row(page, 'Transfer: Checking')).toBeVisible();

  await page.getByRole('link', { name: 'Budget' }).click();
  await expect(page.getByRole('region', { name: 'Ready to Assign' })).toContainText('$1,000.00');
  await expect(row(page, 'Groceries')).toContainText('-$40.00');
});

test('tracks off-budget accounts and categorizes money leaving the budget', async ({
  page,
  request,
}) => {
  await createCategory(request, 'Investing');
  await page.goto('/');
  await createAccount(page, 'Checking', 'Checking', '1,000');
  await createAccount(page, 'Brokerage', 'Asset (investments, house, car)', '5,000');

  const tracking = page.getByRole('region', { name: 'Tracking accounts' });
  await expect(tracking).toContainText('$5,000.00');
  await expect(page.getByRole('complementary')).toContainText('Net worth');

  await page.getByRole('link', { name: 'Budget' }).click();
  await expect(page.getByRole('region', { name: 'Ready to Assign' })).toContainText('$1,000.00');

  await sidebarAccount(page, 'Checking').click();
  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Transfer').selectOption({ label: 'Brokerage' });
  await expect(form.getByLabel('Category')).toBeEnabled();
  await addTransaction(page, { category: 'Investing', outflow: '100' });
  await expect(row(page, 'Transfer: Brokerage')).toContainText('Investing');
  await expect(sidebarAccount(page, 'Brokerage')).toContainText('$5,100.00');

  await page.getByRole('link', { name: 'Budget' }).click();
  await expect(row(page, 'Investing')).toContainText('-$100.00');
});

test('deletes a transfer from the other side', async ({ page }) => {
  await page.goto('/');
  await createAccount(page, 'Checking', 'Checking', '1,000');
  await createAccount(page, 'Savings', 'Savings');
  await addTransaction(page, { transfer: 'Checking', inflow: '250' });
  await expect(sidebarAccount(page, 'Checking')).toContainText('$750.00');

  await sidebarAccount(page, 'Checking').click();
  await row(page, 'Transfer: Savings').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('matching transaction in Savings');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();

  await expect(sidebarAccount(page, 'Checking')).toContainText('$1,000.00');
  await expect(sidebarAccount(page, 'Savings')).toContainText('$0.00');
});

test('closes an account with a balance and reopens it', async ({ page }) => {
  await page.goto('/');
  await createAccount(page, 'Old Savings', 'Savings', '50');

  await page.getByRole('button', { name: 'Close account' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Balance Adjustment');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Close account' }).click();

  await expect(page.getByText('This account is closed')).toBeVisible();
  await expect(row(page, 'Balance Adjustment')).toContainText('$50.00');
  await expect(page.getByRole('form', { name: 'Add transaction' })).toHaveCount(0);
  await page.getByText('Closed (1)').click();
  await expect(sidebarAccount(page, 'Old Savings')).toContainText('$0.00');

  await page.getByRole('button', { name: 'Reopen account' }).click();
  await expect(page.getByRole('form', { name: 'Add transaction' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Budget accounts' })).toContainText('Old Savings');
});
