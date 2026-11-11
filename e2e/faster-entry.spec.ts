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
  const card = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Rewards Card',
    type: 'credit_card',
    startingBalanceCents: 0,
    date: thisMonthDate(1),
  });
  const group = await post<{ id: number }>(request, '/api/category-groups', { name: 'Everyday' });
  const groceries = await post<{ id: number }>(request, '/api/categories', {
    groupId: group.id,
    name: 'Groceries',
  });
  const dining = await post<{ id: number }>(request, '/api/categories', {
    groupId: group.id,
    name: 'Dining',
  });
  const add = (accountId: number, fields: object) =>
    post<{ id: number }>(request, `/api/accounts/${accountId}/transactions`, {
      date: thisMonthDate(2),
      amountCents: -10_00,
      ...fields,
    });
  return { checking, card, groceries, dining, add };
}

function row(page: Page, text: string) {
  return page.getByRole('row').filter({ hasText: text });
}

test('fills in a payee’s usual category', async ({ page, request }) => {
  const { checking, groceries, add } = await setUp(request);
  await add(checking.id, { payee: 'Corner Market', categoryId: groceries.id });
  await page.goto(`/accounts/${checking.id}`);

  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Payee').fill('corner market');
  await expect(form.getByLabel('Category')).toHaveValue(String(groceries.id));
  await form.getByLabel('Outflow').fill('12');
  await form.getByRole('button', { name: 'Add transaction' }).click();

  await expect(row(page, '$12.00')).toContainText('Corner Market');
  await expect(row(page, '$12.00')).toContainText('Groceries');
});

test('keeps a category chosen before the payee', async ({ page, request }) => {
  const { checking, groceries, dining, add } = await setUp(request);
  await add(checking.id, { payee: 'Corner Market', categoryId: groceries.id });
  await page.goto(`/accounts/${checking.id}`);

  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Category').selectOption({ label: 'Dining' });
  await form.getByLabel('Payee').fill('Corner Market');
  await expect(form.getByLabel('Category')).toHaveValue(String(dining.id));
});

test('toggles cleared status and updates the balances', async ({ page, request }) => {
  const { checking, add } = await setUp(request);
  await add(checking.id, { payee: 'Corner Market', amountCents: -30_00 });
  await page.goto(`/accounts/${checking.id}`);

  const balances = page.getByRole('region', { name: 'Balances' });
  await expect(balances).toContainText('Cleared $1,000.00');
  await expect(balances).toContainText('Uncleared -$30.00');
  await expect(balances).toContainText('Working $970.00');

  await row(page, 'Corner Market').getByRole('button', { name: 'Uncleared' }).click();
  await expect(row(page, 'Corner Market').getByRole('button', { name: 'Cleared' })).toBeVisible();
  await expect(balances).toContainText('Cleared $970.00');
  await expect(balances).toContainText('Uncleared $0.00');
});

test('filters an account register', async ({ page, request }) => {
  const { checking, add } = await setUp(request);
  await add(checking.id, { payee: 'Corner Market' });
  await add(checking.id, { payee: 'Noodle House' });
  await page.goto(`/accounts/${checking.id}`);

  await page.getByLabel('Filter transactions').fill('noodle');

  await expect(row(page, 'Noodle House')).toBeVisible();
  await expect(row(page, 'Corner Market')).toHaveCount(0);
});

test('searches and filters all transactions, and edits a result', async ({ page, request }) => {
  const { checking, card, dining, add } = await setUp(request);
  await add(checking.id, { payee: 'Corner Market', memo: 'weekly shop' });
  await add(card.id, { payee: 'Noodle House', categoryId: dining.id, amountCents: -25_00 });
  await page.goto('/');

  await expect(page.getByText('1 transaction needs a category')).toBeVisible();
  await page.getByRole('link', { name: 'Checking (1)' }).click();
  await expect(page.getByRole('heading', { name: 'All transactions' })).toBeVisible();
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue('uncategorized');
  await expect(row(page, 'Corner Market')).toBeVisible();
  await expect(row(page, 'Noodle House')).toHaveCount(0);

  await row(page, 'Corner Market').getByRole('button', { name: 'Edit' }).click();
  const editForm = page.getByRole('form', { name: 'Edit transaction' });
  await editForm.getByLabel('Category').selectOption({ label: 'Dining' });
  await editForm.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('No transactions match.')).toBeVisible();

  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'All categories' });
  await page.getByLabel('Account', { exact: true }).selectOption({ label: 'All accounts' });
  await page.getByLabel('Search', { exact: true }).fill('weekly');
  await expect(row(page, 'Corner Market')).toContainText('Dining');
  await expect(row(page, 'Noodle House')).toHaveCount(0);

  await page.getByLabel('Search', { exact: true }).fill('');
  await page.getByLabel('Account', { exact: true }).selectOption({ label: 'Rewards Card' });
  await expect(row(page, 'Noodle House')).toContainText('Rewards Card');
  await expect(page.getByLabel('Results summary')).toContainText('1 transaction');
  await expect(page.getByLabel('Results summary')).toContainText('-$25.00');
});
