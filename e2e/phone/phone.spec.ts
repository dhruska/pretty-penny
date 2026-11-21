import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resetDb } from '../reset-db';

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
    name: 'Everyday Checking',
    startingBalanceCents: 1_000_00,
    date: thisMonthDate(1),
  });
  const card = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Northwind Premier Travel Rewards',
    type: 'credit_card',
    startingBalanceCents: -1_876_42,
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
  return { checking, card, groceries, dining };
}

/** Fails if the page scrolls sideways, which phone layouts must never do. */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('navigates from the menu, which keeps names and balances on one line', async ({
  page,
  request,
}) => {
  const { card } = await setUp(request);
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Pretty Penny' });
  const cardLink = menu.getByRole('link', { name: /Northwind Premier/ });
  await expect(cardLink).toContainText('-$1,876.42');
  // The balance stays on one line beside the shortened name.
  const balance = cardLink.getByText('-$1,876.42');
  const nameBox = (await cardLink.locator('span').first().boundingBox())!;
  const balanceBox = (await balance.boundingBox())!;
  expect(balanceBox.height).toBeLessThan(30);
  expect(Math.abs(balanceBox.y - nameBox.y)).toBeLessThan(10);

  // A link to the page already showing still closes the menu.
  await menu.getByRole('link', { name: 'Budget' }).click();
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();

  await cardLink.click();
  await expect(menu).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Northwind Premier Travel Rewards' }),
  ).toBeVisible();
  expect(page.url()).toContain(`/accounts/${card.id}`);
  // Away from the budget, the top bar shows Ready to Assign.
  await expect(page.getByRole('link', { name: 'Ready to Assign' })).toBeVisible();
  await expectNoSidewaysScroll(page);

  // Adding an account opens a dialog from the menu.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('dialog', { name: 'Pretty Penny' })
    .getByRole('button', { name: 'Add account' })
    .click();
  await page.getByLabel('Account name').fill('Savings');
  await page.getByLabel('Starting balance', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('heading', { name: 'Savings' })).toBeVisible();
});

test('assigns and moves money from a category’s panel', async ({ page, request }) => {
  await setUp(request);
  await page.goto('/');
  await expectNoSidewaysScroll(page);

  await page.getByRole('button', { name: 'Groceries, $0.00 available' }).click();
  const panel = page.getByRole('dialog', { name: 'Groceries' });
  await panel.getByLabel('Assigned for Groceries').fill('300');
  await panel.getByLabel('Assigned for Groceries').press('Enter');
  await expect(panel.getByText('$300.00').last()).toBeVisible();

  const moveOut = panel.getByRole('form', { name: 'Move money out' });
  await moveOut.getByLabel('Amount').fill('50');
  await moveOut.getByLabel('To').selectOption({ label: 'Dining' });
  await moveOut.getByRole('button', { name: 'Move' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Groceries, $250.00 available' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dining, $50.00 available' })).toBeVisible();
});

test('adds, edits, splits, flags and deletes transactions full screen', async ({
  page,
  request,
}) => {
  const { checking } = await setUp(request);
  await page.goto(`/accounts/${checking.id}`);
  await expectNoSidewaysScroll(page);

  // Adding opens the form full screen.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  let form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Payee').fill('Corner Market');
  await form.getByLabel('Category').selectOption({ label: 'Groceries' });
  await form.getByLabel('Outflow').fill('42.50');
  await form.getByRole('button', { name: 'Add transaction' }).click();
  await expect(form).toBeHidden();
  const list = page.getByRole('list', { name: 'Transactions' });
  await expect(list.getByRole('listitem').filter({ hasText: 'Corner Market' })).toContainText(
    '-$42.50',
  );

  // Tapping a row opens it for editing; here it becomes a split.
  await list.getByRole('button', { name: /^Edit Corner Market/ }).click();
  form = page.getByRole('form', { name: 'Edit transaction' });
  await form.getByRole('button', { name: 'Split' }).click();
  await form.getByLabel('Line 1 outflow').fill('30');
  await form.getByLabel('Line 2 category').selectOption({ label: 'Dining' });
  await form.getByLabel('Line 2 outflow').fill('12.50');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  const row = list.getByRole('listitem').filter({ hasText: 'Corner Market' });
  await expect(row).toContainText('Split (2)');

  // Flag and clear from the row.
  await row.getByRole('button', { name: 'Flag: No flag' }).click();
  await page.getByRole('group', { name: 'Flag' }).getByRole('button', { name: 'Green' }).click();
  await expect(row.getByRole('button', { name: 'Flag: Green' })).toBeVisible();
  await row.getByRole('button', { name: 'Uncleared' }).click();
  await expect(row.getByRole('button', { name: 'Cleared' })).toBeVisible();

  // Deleting is inside the edit view.
  await list.getByRole('button', { name: /^Edit Corner Market/ }).click();
  await page.getByRole('button', { name: 'Delete transaction' }).click();
  await expect(list.getByRole('listitem').filter({ hasText: 'Corner Market' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('reconciles and edits the account', async ({ page, request }) => {
  const { checking } = await setUp(request);
  await page.goto(`/accounts/${checking.id}`);

  await page.getByRole('button', { name: 'Reconcile' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText(/Last reconciled/)).toBeVisible();
  await expect(page.getByRole('img', { name: 'Reconciled' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Edit account' }).click();
  const settings = page.getByRole('dialog', { name: 'Edit account' });
  await settings.getByLabel('Account name').fill('Main Checking');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Main Checking' })).toBeVisible();
});

test('enters a scheduled transaction from its edit view', async ({ page, request }) => {
  const { checking } = await setUp(request);
  await post(request, `/api/accounts/${checking.id}/scheduled`, {
    date:
      thisMonthDate(28) > new Date().toISOString().slice(0, 10) ? thisMonthDate(28) : '2099-01-01',
    payee: 'Landlord',
    amountCents: -900_00,
    frequency: 'monthly',
  });
  await page.goto(`/accounts/${checking.id}`);

  const scheduled = page.getByRole('region', { name: 'Scheduled transactions' });
  await scheduled.getByRole('button', { name: /^Edit scheduled Landlord/ }).click();
  await page.getByRole('button', { name: 'Enter now' }).click();
  const list = page.getByRole('list', { name: 'Transactions' });
  await expect(list.getByRole('listitem').filter({ hasText: 'Landlord' })).toContainText(
    '-$900.00',
  );
});

test('filters all transactions, and no page scrolls sideways', async ({ page, request }) => {
  const { checking, card, groceries } = await setUp(request);
  for (const [accountId, payee] of [
    [checking.id, 'Hardware Store'],
    [card.id, 'Neighborhood Bistro With A Long Name'],
  ] as const) {
    await post(request, `/api/accounts/${accountId}/transactions`, {
      date: thisMonthDate(2),
      payee,
      amountCents: -1_234_56,
      categoryId: groceries.id,
    });
  }

  await page.goto('/transactions');
  await page.getByLabel('Search').fill('bistro');
  const list = page.getByRole('list', { name: 'Transactions' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Northwind Premier Travel Rewards');
  await expectNoSidewaysScroll(page);

  for (const path of ['/', '/transactions', '/reports', '/import', `/accounts/${card.id}`]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectNoSidewaysScroll(page);
  }
});
