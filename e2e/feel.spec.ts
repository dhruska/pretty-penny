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
  const groceries = await post<{ id: number }>(request, '/api/categories', {
    groupId: group.id,
    name: 'Groceries',
  });
  const dining = await post<{ id: number }>(request, '/api/categories', {
    groupId: group.id,
    name: 'Dining',
  });
  return { checking, groceries, dining };
}

/** Holds matching requests for two seconds, so a test can see the screen change before the server answers. */
async function slowDown(page: Page, method: string, url: RegExp) {
  await page.route(url, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fallback();
  });
}

const readyToAssign = (page: Page) => page.getByRole('region', { name: 'Ready to Assign' });
const row = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

test('assigning and moving money show before the server answers', async ({ page, request }) => {
  await setUp(request);
  await page.goto('/');
  await expect(readyToAssign(page)).toContainText('$1,000.00');

  await slowDown(page, 'PUT', /\/api\/budget\/.*\/categories\//);
  await page.getByLabel('Assigned for Groceries').fill('300');
  await page.getByLabel('Assigned for Groceries').press('Enter');
  await expect(readyToAssign(page)).toContainText('$700.00', { timeout: 1000 });
  await expect(page.getByRole('button', { name: '$300.00 available in Groceries' })).toBeVisible({
    timeout: 1000,
  });

  await slowDown(page, 'POST', /\/api\/budget\/.*\/move/);
  await page.getByRole('button', { name: '$300.00 available in Groceries' }).click();
  const moveOut = page.getByRole('form', { name: 'Move money out' });
  await moveOut.getByLabel('Amount').fill('50');
  await moveOut.getByLabel('To').selectOption({ label: 'Dining' });
  await moveOut.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByRole('button', { name: '$50.00 available in Dining' })).toBeVisible({
    timeout: 1000,
  });
  await expect(page.getByText('Moved $50.00 to Dining')).toBeVisible();
});

test('a refused change is put back, with a message', async ({ page, request }) => {
  await setUp(request);
  await page.goto('/');
  await page.route(/\/api\/budget\/.*\/categories\//, (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 400, json: { message: 'The server refused that.' } })
      : route.fallback(),
  );
  await page.getByLabel('Assigned for Groceries').fill('300');
  await page.getByLabel('Assigned for Groceries').press('Enter');
  await expect(page.getByText('The server refused that.')).toBeVisible();
  await expect(readyToAssign(page)).toContainText('$1,000.00');
  await expect(page.getByLabel('Assigned for Groceries')).toHaveValue('$0.00');
});

test('clearing and flagging show at once, and deleting offers Undo', async ({ page, request }) => {
  const { checking } = await setUp(request);
  await post(request, `/api/accounts/${checking.id}/transactions`, {
    date: thisMonthDate(3),
    payee: 'Corner Market',
    amountCents: -40_00,
  });
  await page.goto(`/accounts/${checking.id}`);
  const balances = page.getByRole('region', { name: 'Balances' });
  await expect(balances).toContainText('Cleared $1,000.00');

  await slowDown(page, 'PATCH', /\/api\/transactions\/\d+$/);
  await row(page, 'Corner Market').getByRole('button', { name: 'Uncleared' }).click();
  await expect(row(page, 'Corner Market').getByRole('button', { name: 'Cleared' })).toBeVisible({
    timeout: 1000,
  });
  await expect(balances).toContainText('Cleared $960.00', { timeout: 1000 });

  await row(page, 'Corner Market').getByRole('button', { name: 'Flag: No flag' }).click();
  await page.getByRole('group', { name: 'Flag' }).getByRole('button', { name: 'Purple' }).click();
  await expect(
    row(page, 'Corner Market').getByRole('button', { name: 'Flag: Purple' }),
  ).toBeVisible({ timeout: 1000 });
  await page.unrouteAll({ behavior: 'wait' });

  // Deleting takes it away at once; Undo puts it back as it was, flag and all.
  await row(page, 'Corner Market').getByRole('button', { name: 'Delete' }).click();
  await expect(row(page, 'Corner Market')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Transaction restored')).toBeVisible();
  await expect(
    row(page, 'Corner Market').getByRole('button', { name: 'Flag: Purple' }),
  ).toBeVisible();
  await expect(row(page, 'Corner Market').getByRole('button', { name: 'Cleared' })).toBeVisible();
});

test('confirms what happened with a short message', async ({ page, request }) => {
  const { checking } = await setUp(request);
  await page.goto(`/accounts/${checking.id}`);
  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Payee').fill('Bakery');
  await form.getByLabel('Outflow').fill('6');
  await form.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByText('Transaction added')).toBeVisible();

  await row(page, 'Bakery').getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Memo').fill('bread');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Transaction saved')).toBeVisible();
});

test('loads a long register a page at a time, and the filter finds older ones', async ({
  page,
  request,
}) => {
  const { checking } = await setUp(request);
  // 450 transactions, oldest first, numbered so the oldest are easy to spot.
  for (let start = 0; start < 450; start += 50) {
    await Promise.all(
      Array.from({ length: 50 }, (_, offset) => {
        const index = start + offset;
        return post(request, `/api/accounts/${checking.id}/transactions`, {
          date: `2025-${String(1 + Math.floor(index / 40)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}`,
          payee: `Shop ${String(index).padStart(3, '0')}`,
          amountCents: -1_00,
        });
      }),
    );
  }

  await page.goto(`/accounts/${checking.id}`);
  const rows = page.getByRole('row').filter({ hasText: /Shop \d{3}|Starting Balance/ });
  await expect(rows).toHaveCount(200);

  // Scrolling to the end loads the rest.
  await page.getByRole('button', { name: 'Load more' }).scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(400);
  await page.getByRole('button', { name: 'Load more' }).scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(451);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  await expect(row(page, 'Starting Balance')).toContainText('$1,000.00');

  // The filter searches the whole account, including transactions not loaded yet.
  await page.reload();
  await expect(rows).toHaveCount(200);
  await page.getByLabel('Filter transactions').fill('Shop 003');
  await expect(page.getByRole('row').filter({ hasText: 'Shop' })).toHaveCount(1);
});

test('starts loading an account when its link is hovered', async ({ page, request }) => {
  const { checking } = await setUp(request);
  await page.goto('/');
  const loaded = page.waitForRequest(new RegExp(`/api/accounts/${checking.id}/transactions`));
  await page
    .getByRole('complementary', { name: 'Accounts' })
    .getByRole('link', { name: /Checking/ })
    .hover();
  await loaded;
});

test('shows placeholders while loading', async ({ page, request }) => {
  await setUp(request);
  await slowDown(page, 'GET', /\/api\/budget\?/);
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Loading the budget' })).toBeVisible();
  await expect(page.getByLabel('Assigned for Groceries')).toBeVisible({ timeout: 5000 });
});

test('keyboard shortcuts move between months, add, search and list themselves', async ({
  page,
  request,
}) => {
  const { checking } = await setUp(request);
  await page.goto('/');
  const heading = page.getByRole('heading', { name: /^[A-Z][a-z]+ \d{4}$/ });
  await expect(page.getByLabel('Assigned for Groceries')).toBeVisible();
  const thisMonth = await heading.textContent();

  await page.keyboard.press('ArrowRight');
  await expect(heading).not.toHaveText(thisMonth!);
  await page.keyboard.press('t');
  await expect(heading).toHaveText(thisMonth!);

  // Typing in a field isn't a shortcut.
  await page.getByLabel('Assigned for Groceries').fill('');
  await page.getByLabel('Assigned for Groceries').press('ArrowRight');
  await expect(heading).toHaveText(thisMonth!);
  await page.getByLabel('Assigned for Groceries').blur();

  await page.keyboard.press('?');
  const list = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(list).toContainText('Add a transaction');
  await page.keyboard.press('Escape');

  await page.goto(`/accounts/${checking.id}`);
  await expect(row(page, 'Starting Balance')).toBeVisible();
  await page.keyboard.press('n');
  await expect(
    page.getByRole('form', { name: 'Add transaction' }).getByLabel('Payee'),
  ).toBeFocused();
  await page.getByRole('form', { name: 'Add transaction' }).getByLabel('Payee').blur();
  await page.keyboard.press('/');
  await expect(page.getByLabel('Filter transactions')).toBeFocused();
});

test.describe('motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('dialogs animate in, unless reduced motion is on', async ({ page, request }) => {
    await setUp(request);
    await page.goto('/');
    await expect(page.getByLabel('Assigned for Groceries')).toBeVisible();
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    const duration = () =>
      dialog.evaluate((element) => getComputedStyle(element).animationDuration);
    expect(await duration()).toBe('0.15s');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(parseFloat(await duration())).toBeLessThan(0.001);
  });
});
