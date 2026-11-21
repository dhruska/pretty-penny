import { expect, test } from '@playwright/test';
import { resetDb } from './reset-db';

test.beforeEach(() => resetDb());

const isDark = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'));

test('switches between light, dark and the device’s setting, and remembers it', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const theme = page.getByRole('group', { name: 'Theme' });
  await expect(theme.getByRole('button', { name: 'System' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await isDark(page)).toBe(false);

  await theme.getByRole('button', { name: 'Dark' }).click();
  await expect.poll(() => isDark(page)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(15, 17, 21)');

  // Remembered, and applied before the page draws.
  await page.reload();
  expect(await isDark(page)).toBe(true);

  // System follows the device.
  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'System' }).click();
  await expect.poll(() => isDark(page)).toBe(false);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => isDark(page)).toBe(true);
});

async function post<T>(
  request: import('@playwright/test').APIRequestContext,
  url: string,
  data: object,
) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

function thisMonthDate(day: number) {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

test('the budget shows month totals, plain Assigned amounts, and each category’s activity', async ({
  page,
  request,
}) => {
  const checking = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Checking',
    startingBalanceCents: 1_000_00,
    date: thisMonthDate(1),
  });
  const group = await post<{ id: number }>(request, '/api/category-groups', { name: 'Everyday' });
  const groceries = await post<{ id: number }>(request, '/api/categories', {
    groupId: group.id,
    name: 'Groceries',
  });
  const home = await post<{ id: number }>(request, '/api/categories', {
    groupId: group.id,
    name: 'Home',
  });
  await post(request, `/api/accounts/${checking.id}/transactions`, {
    date: thisMonthDate(2),
    payee: 'Corner Market',
    amountCents: -40_00,
    categoryId: groceries.id,
  });
  await post(request, `/api/accounts/${checking.id}/transactions`, {
    date: thisMonthDate(3),
    payee: 'Costco',
    amountCents: -90_00,
    lines: [
      { categoryId: groceries.id, amountCents: -60_00 },
      { categoryId: home.id, amountCents: -30_00 },
    ],
  });
  await page.goto('/');

  // Assigned reads as a plain amount, editable in place; Escape puts it back.
  const assigned = page.getByLabel('Assigned for Groceries');
  await expect(assigned).toHaveValue('$0.00');
  await assigned.fill('250');
  await assigned.press('Enter');
  await expect(assigned).toHaveValue('$250.00');
  await assigned.fill('999');
  await assigned.press('Escape');
  await expect(assigned).toHaveValue('$250.00');

  await expect(page.getByRole('region', { name: 'Ready to Assign' })).toContainText('$750.00');
  await expect(page.getByRole('region', { name: 'Assigned this month' })).toContainText('$250.00');
  await expect(page.getByRole('region', { name: 'Spent this month' })).toContainText('$130.00');

  // Activity lists the month's transactions, with only this category's part of a split.
  await page.getByRole('button', { name: 'Activity in Groceries: -$100.00' }).click();
  const activity = page.getByRole('dialog', { name: 'Groceries activity' });
  await expect(activity.getByRole('listitem')).toHaveCount(2);
  await expect(activity.getByRole('listitem').filter({ hasText: 'Costco' })).toContainText(
    '-$60.00',
  );
  await activity.getByRole('link', { name: 'See them in All transactions' }).click();
  await expect(page).toHaveURL(/\/transactions\?categoryId=\d+&from=/);
  await expect(page.getByLabel('Results summary')).toContainText('2 transactions');
});

test('register rows show friendly dates and open for editing when clicked', async ({
  page,
  request,
}) => {
  const checking = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Checking',
    startingBalanceCents: 1_000_00,
    date: thisMonthDate(1),
  });
  await post(request, `/api/accounts/${checking.id}/transactions`, {
    date: thisMonthDate(2),
    payee: 'Corner Market',
    amountCents: -40_00,
  });
  await page.goto(`/accounts/${checking.id}`);
  const row = page.getByRole('row').filter({ hasText: 'Corner Market' });
  const month = new Date().toLocaleString('en-US', { month: 'short' });
  await expect(row.locator('time')).toHaveText(`${month} 2`);

  // Clicking the cleared toggle doesn't open the row; clicking the row does.
  await row.getByRole('button', { name: 'Uncleared' }).click();
  await expect(page.getByRole('form', { name: 'Edit transaction' })).toHaveCount(0);
  await row.getByText('Corner Market').click();
  await expect(
    page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Payee'),
  ).toHaveValue('Corner Market');
});

test('Add transaction opens a form that stays open for the next one until closed', async ({
  page,
  request,
}) => {
  const checking = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Checking',
    startingBalanceCents: 1_000_00,
    date: thisMonthDate(1),
  });
  await page.goto(`/accounts/${checking.id}`);
  const form = page.getByRole('form', { name: 'Add transaction' });
  await expect(form).toHaveCount(0);

  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(form.getByLabel('Payee')).toBeFocused();
  for (const payee of ['Bakery', 'Florist']) {
    await form.getByLabel('Payee').fill(payee);
    await form.getByLabel('Outflow').fill('5');
    await form.getByRole('button', { name: 'Add transaction' }).click();
    await expect(page.getByRole('row').filter({ hasText: payee })).toBeVisible();
    await expect(form.getByLabel('Payee')).toBeFocused();
  }

  await form.getByRole('button', { name: 'Close' }).click();
  await expect(form).toHaveCount(0);
});

test('an account’s name and type are changed in Edit account', async ({ page, request }) => {
  const savings = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Savings',
    type: 'savings',
    startingBalanceCents: 0,
    date: thisMonthDate(1),
  });
  await page.goto(`/accounts/${savings.id}`);
  await expect(page.getByText('Savings · Budget account')).toBeVisible();

  await page.getByRole('button', { name: 'Edit account' }).click();
  const settings = page.getByRole('dialog', { name: 'Edit account' });
  // Only types on the same side, budget or tracking, are offered.
  const types = settings.getByLabel('Account type');
  await expect(types.locator('option', { hasText: 'Asset' })).toHaveCount(0);
  await types.selectOption({ label: 'Cash' });
  await settings.getByLabel('Account name').fill('Rainy Day Cash');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Account saved')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rainy Day Cash' })).toBeVisible();
  await expect(page.getByText('Cash · Budget account')).toBeVisible();
});

test('a new budget welcomes you with first steps', async ({ page }) => {
  await page.goto('/');
  const welcome = page.getByRole('region', { name: 'Welcome' });
  await expect(welcome).toContainText('Welcome to Pretty Penny');
  await expect(page.getByText('No categories yet')).toBeVisible();

  await welcome.getByRole('button', { name: 'Manage categories' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

  await welcome.getByRole('button', { name: 'Add account' }).click();
  await page.getByLabel('Account name').fill('Checking');
  await page.getByLabel('Starting balance', { exact: true }).fill('100');
  await page.getByRole('dialog').getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('heading', { name: 'Checking' })).toBeVisible();

  // With an account, the budget is no longer new.
  await page.getByRole('link', { name: 'Budget' }).click();
  await expect(page.getByRole('region', { name: 'Welcome' })).toHaveCount(0);
});
