import { expect, test, type Page } from '@playwright/test';
import { resetDb } from './reset-db';

test.beforeEach(() => resetDb());

function sidebarAccount(page: Page, name: string) {
  return page.getByRole('complementary', { name: 'Accounts' }).getByRole('link', { name });
}

function row(page: Page, payee: string) {
  return page.getByRole('row').filter({ hasText: payee });
}

async function addTransaction(
  page: Page,
  fields: { payee: string; outflow?: string; inflow?: string },
) {
  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Payee').fill(fields.payee);
  if (fields.outflow) await form.getByLabel('Outflow').fill(fields.outflow);
  if (fields.inflow) await form.getByLabel('Inflow').fill(fields.inflow);
  await form.getByRole('button', { name: 'Add transaction' }).click();
}

test('manages an account and its transactions, keeping balances correct', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Account name').fill('Checking');
  await page.getByLabel('Starting balance').fill('1,000.00');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(sidebarAccount(page, 'Checking')).toContainText('$1,000.00');
  await expect(row(page, 'Starting Balance')).toContainText('$1,000.00');

  await addTransaction(page, { payee: 'Groceries', outflow: '25.50' });
  await expect(sidebarAccount(page, 'Checking')).toContainText('$974.50');
  await expect(row(page, 'Groceries')).toContainText('$974.50');

  await addTransaction(page, { payee: 'Paycheck', inflow: '100' });
  await expect(sidebarAccount(page, 'Checking')).toContainText('$1,074.50');

  await row(page, 'Groceries').getByRole('button', { name: 'Edit' }).click();
  const editForm = page.getByRole('form', { name: 'Edit transaction' });
  await expect(editForm.getByLabel('Outflow')).toHaveValue('25.50');
  await editForm.getByLabel('Outflow').fill('30');
  await editForm.getByRole('button', { name: 'Save' }).click();
  await expect(sidebarAccount(page, 'Checking')).toContainText('$1,070.00');
  await expect(editForm).toBeHidden();

  await row(page, 'Paycheck').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(sidebarAccount(page, 'Checking')).toContainText('$970.00');
  await expect(row(page, 'Paycheck')).toHaveCount(0);

  await page.reload();
  await expect(sidebarAccount(page, 'Checking')).toContainText('$970.00');
});

test('shows validation messages and refuses to delete an account in use', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Account name').fill('Savings');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(sidebarAccount(page, 'Savings')).toContainText('$0.00');

  await addTransaction(page, { payee: 'Bad', outflow: '1.234' });
  await expect(page.getByText('Enter a positive amount')).toBeVisible();
  await page.getByRole('form', { name: 'Add transaction' }).getByLabel('Outflow').fill('5');
  await page
    .getByRole('form', { name: 'Add transaction' })
    .getByRole('button', { name: 'Add transaction' })
    .click();
  await expect(sidebarAccount(page, 'Savings')).toContainText('-$5.00');

  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Delete this account’s transactions')).toBeVisible();
  await expect(sidebarAccount(page, 'Savings')).toBeVisible();
});

test('renames and deletes an account', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Account name').fill('Old name');
  await page.getByLabel('Starting balance').fill('50');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(sidebarAccount(page, 'Old name')).toBeVisible();

  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('main').getByLabel('Account name').fill('New name');
  await page.getByRole('main').getByRole('button', { name: 'Save' }).click();
  await expect(sidebarAccount(page, 'New name')).toBeVisible();

  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('region', { name: 'Ready to Assign' })).toBeVisible();
  await expect(sidebarAccount(page, 'New name')).toHaveCount(0);
});
