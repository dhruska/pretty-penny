import { expect, test, type Page } from '@playwright/test';
import { resetDb } from './reset-db';

test.beforeEach(() => resetDb());

function readyToAssign(page: Page) {
  return page.getByRole('region', { name: 'Ready to Assign' });
}

function row(page: Page, text: string) {
  return page.getByRole('row').filter({ hasText: text });
}

async function createAccount(page: Page, name: string, startingBalance: string) {
  await page.getByLabel('Account name').fill(name);
  await page.getByLabel('Starting balance').fill(startingBalance);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function openBudget(page: Page) {
  await page.getByRole('link', { name: 'Budget' }).click();
  await expect(readyToAssign(page)).toBeVisible();
}

async function createCategory(page: Page, group: string, category: string) {
  await page.getByRole('button', { name: 'Manage categories' }).click();
  await page.getByLabel('New group name').fill(group);
  await page.getByRole('button', { name: 'Add group' }).click();
  await page.getByLabel(`New category in ${group}`).fill(category);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('button', { name: `Rename ${category}` })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
}

async function assign(page: Page, category: string, amount: string) {
  const input = page.getByLabel(`Assigned for ${category}`);
  await input.fill(amount);
  await input.press('Enter');
}

async function addTransaction(page: Page, payee: string, outflow: string, category?: string) {
  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Payee').fill(payee);
  if (category) await form.getByLabel('Category').selectOption({ label: category });
  await form.getByLabel('Outflow').fill(outflow);
  await form.getByRole('button', { name: 'Add transaction' }).click();
  await expect(row(page, payee)).toBeVisible();
}

test('assigns money, records spending, and rolls the balance forward', async ({ page }) => {
  await page.goto('/');
  await createAccount(page, 'Checking', '1,000');
  await expect(row(page, 'Starting Balance')).toContainText('Ready to Assign');

  await openBudget(page);
  await expect(readyToAssign(page)).toContainText('$1,000.00');

  await createCategory(page, 'Everyday', 'Groceries');
  await assign(page, 'Groceries', '300');
  await expect(readyToAssign(page)).toContainText('$700.00');
  await expect(row(page, 'Groceries')).toContainText('$300.00');

  await page.getByRole('link', { name: /Checking/ }).click();
  await addTransaction(page, 'Corner Market', '50', 'Groceries');
  await expect(row(page, 'Corner Market')).toContainText('Groceries');

  await openBudget(page);
  await expect(row(page, 'Groceries')).toContainText('-$50.00');
  await expect(row(page, 'Groceries')).toContainText('$250.00');
  await expect(readyToAssign(page)).toContainText('$700.00');

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByLabel('Assigned for Groceries')).toHaveValue('0.00');
  await expect(row(page, 'Groceries')).toContainText('$250.00');
  await expect(readyToAssign(page)).toContainText('$700.00');

  await assign(page, 'Groceries', '25');
  await expect(row(page, 'Groceries')).toContainText('$275.00');
  await expect(readyToAssign(page)).toContainText('$675.00');

  await page.getByRole('button', { name: 'This month' }).click();
  await expect(page.getByLabel('Assigned for Groceries')).toHaveValue('300.00');
});

test('flags uncategorized transactions until they have a category', async ({ page }) => {
  await page.goto('/');
  await createAccount(page, 'Checking', '100');
  await openBudget(page);
  await createCategory(page, 'Everyday', 'Groceries');

  await page.getByRole('link', { name: /Checking/ }).click();
  await addTransaction(page, 'Mystery Shop', '10');
  await expect(row(page, 'Mystery Shop')).toContainText('Uncategorized');

  await openBudget(page);
  await expect(page.getByText('1 transaction needs a category')).toBeVisible();
  await expect(row(page, 'Groceries')).toContainText('$0.00');

  await page.getByRole('link', { name: 'Checking (1)' }).click();
  await row(page, 'Mystery Shop').getByRole('button', { name: 'Edit' }).click();
  const editForm = page.getByRole('form', { name: 'Edit transaction' });
  await editForm.getByLabel('Category').selectOption({ label: 'Groceries' });
  await editForm.getByRole('button', { name: 'Save' }).click();
  // The notice opens the Uncategorized list, so the transaction leaves it once categorized.
  await expect(page.getByText('No transactions match.')).toBeVisible();

  await openBudget(page);
  await expect(page.getByText('needs a category')).toHaveCount(0);
  await expect(row(page, 'Groceries')).toContainText('-$10.00');
});

test('hides, reveals, reorders, and deletes categories', async ({ page }) => {
  await page.goto('/');
  await createAccount(page, 'Checking', '100');
  await openBudget(page);
  await createCategory(page, 'Everyday', 'Groceries');

  await page.getByRole('button', { name: 'Manage categories' }).click();
  await page.getByLabel('New category in Everyday').fill('Gas');
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByRole('button', { name: 'Move Gas up' }).click();
  await page.getByRole('button', { name: 'Hide Gas' }).click();
  await expect(page.getByRole('button', { name: 'Unhide Gas' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(row(page, 'Groceries')).toBeVisible();
  await expect(row(page, 'Gas')).toHaveCount(0);

  await page.getByLabel('Show hidden').check();
  await expect(page.getByRole('row').nth(2)).toContainText('Gas');
  await expect(page.getByRole('row').nth(3)).toContainText('Groceries');

  await page.getByRole('button', { name: 'Manage categories' }).click();
  const group = page.getByRole('region', { name: 'Everyday group' });
  await group
    .locator('div')
    .filter({ has: page.getByRole('button', { name: 'Unhide Gas' }) })
    .last()
    .getByRole('button', { name: 'Delete' })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Unhide Gas' })).toHaveCount(0);
});

test('refuses to delete a category that has been used', async ({ page }) => {
  await page.goto('/');
  await createAccount(page, 'Checking', '100');
  await openBudget(page);
  await createCategory(page, 'Everyday', 'Groceries');
  await assign(page, 'Groceries', '10');
  await expect(readyToAssign(page)).toContainText('$90.00');

  await page.getByRole('button', { name: 'Manage categories' }).click();
  await page
    .getByRole('region', { name: 'Everyday group' })
    .getByRole('button', { name: 'Delete' })
    .last()
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('This category has been used')).toBeVisible();
});
