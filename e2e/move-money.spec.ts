import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resetDb } from './reset-db';

test.beforeEach(() => resetDb());

function monthOffset(delta: number) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const THIS_MONTH = monthOffset(0);
const LAST_MONTH = monthOffset(-1);

async function post<T>(request: APIRequestContext, url: string, data: object) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return (response.status() === 204 ? undefined : await response.json()) as T;
}

/** Creates a checking account with $1,000 and the named categories, returning their ids. */
async function setUp(request: APIRequestContext, names: string[]) {
  const account = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Checking',
    startingBalanceCents: 1_000_00,
    date: `${LAST_MONTH}-01`,
  });
  const group = await post<{ id: number }>(request, '/api/category-groups', { name: 'Everyday' });
  const ids: Record<string, number> = {};
  for (const name of names) {
    ids[name] = (
      await post<{ id: number }>(request, '/api/categories', { groupId: group.id, name })
    ).id;
  }

  const assign = (name: string, assignedCents: number, month = THIS_MONTH) =>
    request.put(`/api/budget/${month}/categories/${ids[name]}`, { data: { assignedCents } });
  const spend = (name: string, amountCents: number, month = THIS_MONTH) =>
    post(request, `/api/accounts/${account.id}/transactions`, {
      date: `${month}-02`,
      amountCents,
      categoryId: ids[name],
    });
  return { assign, spend };
}

function row(page: Page, category: string) {
  return page.getByRole('row').filter({ hasText: category });
}

function readyToAssign(page: Page) {
  return page.getByRole('region', { name: 'Ready to Assign' });
}

async function openCategory(page: Page, category: string) {
  await page.getByRole('button', { name: new RegExp(`available in ${category}$`) }).click();
  return page.getByRole('dialog', { name: `Move money for ${category}` });
}

test('covers overspending from another category', async ({ page, request }) => {
  const { assign, spend } = await setUp(request, ['Groceries', 'Dining']);
  await assign('Groceries', 100_00);
  await spend('Dining', -30_00);
  await page.goto('/');
  await expect(row(page, 'Dining')).toContainText('-$30.00');

  const dialog = await openCategory(page, 'Dining');
  const cover = dialog.getByRole('form', { name: 'Cover overspending' });
  await expect(cover.getByLabel('Amount')).toHaveValue('30.00');
  await cover.getByLabel('From').selectOption({ label: 'Groceries ($100.00)' });
  await cover.getByRole('button', { name: 'Cover' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '$0.00 available in Dining' })).toBeVisible();
  await expect(page.getByRole('button', { name: '$70.00 available in Groceries' })).toBeVisible();
  await expect(readyToAssign(page)).toContainText('$900.00');
});

test('moves money back to Ready to Assign', async ({ page, request }) => {
  const { assign } = await setUp(request, ['Groceries']);
  await assign('Groceries', 100_00);
  await page.goto('/');

  const dialog = await openCategory(page, 'Groceries');
  const moveOut = dialog.getByRole('form', { name: 'Move money out' });
  await moveOut.getByLabel('Amount').fill('25');
  await expect(moveOut.getByLabel('To', { exact: true })).toHaveValue('');
  await moveOut.getByRole('button', { name: 'Move', exact: true }).click();

  await expect(readyToAssign(page)).toContainText('$925.00');
  await expect(page.getByLabel('Assigned for Groceries')).toHaveValue('75.00');
});

test('auto-assigns across the budget', async ({ page, request }) => {
  const { assign, spend } = await setUp(request, ['Rent', 'Dining']);
  await assign('Rent', 800_00, LAST_MONTH);
  await spend('Dining', -30_00);
  await page.goto('/');

  await page.getByRole('button', { name: 'Auto-assign' }).click();
  const menu = page.getByRole('dialog', { name: 'Auto-assign' });
  await expect(menu.getByRole('button', { name: /Assigned last month/ })).toContainText('$800.00');
  await menu.getByRole('button', { name: /Assigned last month/ }).click();
  await expect(page.getByLabel('Assigned for Rent')).toHaveValue('800.00');

  await page.getByRole('button', { name: 'Auto-assign' }).click();
  await expect(menu.getByRole('button', { name: /Assigned last month/ })).toBeDisabled();
  await menu.getByRole('button', { name: /Underfunded/ }).click();
  await expect(page.getByRole('button', { name: '$0.00 available in Dining' })).toBeVisible();
  await expect(readyToAssign(page)).toContainText('-$630.00');
});

test('auto-assigns a single category', async ({ page, request }) => {
  const { spend } = await setUp(request, ['Groceries', 'Dining']);
  await spend('Groceries', -80_00, LAST_MONTH);
  await spend('Dining', -60_00, LAST_MONTH);
  await page.goto('/');

  const dialog = await openCategory(page, 'Groceries');
  await dialog.getByRole('button', { name: /Spent last month/ }).click();

  await expect(page.getByLabel('Assigned for Groceries')).toHaveValue('80.00');
  await expect(page.getByLabel('Assigned for Dining')).toHaveValue('0.00');
});
