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

async function setUp(request: APIRequestContext) {
  const checking = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Checking',
    startingBalanceCents: 1_000_00,
    date: thisMonthDate(1),
  });
  const group = await post<{ id: number }>(request, '/api/category-groups', { name: 'Everyday' });
  for (const name of ['Groceries', 'Household']) {
    await post(request, '/api/categories', { groupId: group.id, name });
  }
  return checking;
}

function row(page: Page, text: string) {
  return page.getByRole('row').filter({ hasText: text });
}

function budgetRow(page: Page, category: string) {
  return page.getByRole('row').filter({ hasText: category });
}

async function fillLine(page: Page, number: number, category: string, outflow: string) {
  const lines = page.getByRole('region', { name: 'Split lines' });
  await lines.getByLabel(`Line ${number} category`).selectOption({ label: category });
  await lines.getByLabel(`Line ${number} outflow`).fill(outflow);
}

test('splits a purchase across categories', async ({ page, request }) => {
  const checking = await setUp(request);
  await page.goto(`/accounts/${checking.id}`);

  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Payee').fill('Target');
  await form.getByLabel('Outflow').fill('100');
  await form.getByRole('button', { name: 'Split' }).click();
  await fillLine(page, 1, 'Groceries', '60');
  await expect(form.getByRole('status', { name: 'Remaining' })).toContainText('-$40.00');

  await form.getByRole('button', { name: 'Add transaction' }).click();
  await expect(form.getByText('-$40.00 is left to assign')).toBeVisible();

  await fillLine(page, 2, 'Household', '40');
  await expect(form.getByRole('status', { name: 'Remaining' })).toContainText('$0.00');
  await form.getByRole('button', { name: 'Add transaction' }).click();

  await expect(row(page, 'Target')).toContainText('Split (2)');
  await row(page, 'Target').getByRole('button', { name: 'Split (2)' }).click();
  await expect(page.getByRole('row', { name: 'Split line 1' })).toContainText('Groceries');
  await expect(page.getByRole('row', { name: 'Split line 2' })).toContainText('$40.00');

  await page.getByRole('link', { name: 'Budget' }).click();
  await expect(budgetRow(page, 'Groceries')).toContainText('-$60.00');
  await expect(budgetRow(page, 'Household')).toContainText('-$40.00');
});

test('spreads the remaining amount across the lines', async ({ page, request }) => {
  const checking = await setUp(request);
  await page.goto(`/accounts/${checking.id}`);

  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Payee').fill('Hardware Store');
  await form.getByLabel('Outflow').fill('110');
  await form.getByRole('button', { name: 'Split' }).click();
  await fillLine(page, 1, 'Groceries', '60');
  await fillLine(page, 2, 'Household', '40');
  await form.getByRole('button', { name: 'Spread remaining' }).click();

  const lines = page.getByRole('region', { name: 'Split lines' });
  await expect(lines.getByLabel('Line 1 outflow')).toHaveValue('66.00');
  await expect(lines.getByLabel('Line 2 outflow')).toHaveValue('44.00');
  await form.getByRole('button', { name: 'Add transaction' }).click();

  await page.getByRole('link', { name: 'Budget' }).click();
  await expect(budgetRow(page, 'Groceries')).toContainText('-$66.00');
  await expect(budgetRow(page, 'Household')).toContainText('-$44.00');
});

test('turns a split back into one category', async ({ page, request }) => {
  const checking = await setUp(request);
  await page.goto(`/accounts/${checking.id}`);

  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Payee').fill('Target');
  await form.getByLabel('Outflow').fill('100');
  await form.getByRole('button', { name: 'Split' }).click();
  await fillLine(page, 1, 'Groceries', '60');
  await fillLine(page, 2, 'Household', '40');
  await form.getByRole('button', { name: 'Add transaction' }).click();
  await expect(row(page, 'Target')).toContainText('Split (2)');

  await row(page, 'Target').getByRole('button', { name: 'Edit' }).click();
  const editForm = page.getByRole('form', { name: 'Edit transaction' });
  await expect(editForm.getByRole('region', { name: 'Split lines' })).toBeVisible();
  await editForm.getByRole('button', { name: 'Use one category' }).click();
  await expect(editForm.getByLabel('Category', { exact: true })).toHaveValue(/\d+/);
  await editForm.getByRole('button', { name: 'Save' }).click();
  await expect(row(page, 'Target')).toContainText('Groceries');

  await page.getByRole('link', { name: 'Budget' }).click();
  await expect(budgetRow(page, 'Groceries')).toContainText('-$100.00');
  await expect(budgetRow(page, 'Household')).toContainText('$0.00');
});
