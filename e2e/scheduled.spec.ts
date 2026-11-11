import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resetDb } from './reset-db';

test.beforeEach(() => resetDb());

/** A local date `days` from today, as YYYY-MM-DD. */
function daysFromToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function post<T>(request: APIRequestContext, url: string, data: object) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

async function setUp(request: APIRequestContext) {
  const checking = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Checking',
    startingBalanceCents: 3_000_00,
    date: daysFromToday(-40),
  });
  const group = await post<{ id: number }>(request, '/api/category-groups', { name: 'Bills' });
  await post(request, '/api/categories', { groupId: group.id, name: 'Rent' });
  return checking;
}

function scheduled(page: Page) {
  return page.getByRole('region', { name: 'Scheduled transactions' });
}

async function addRepeating(page: Page, date: string, repeat: string) {
  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Date').fill(date);
  await form.getByLabel('Repeat').selectOption({ label: repeat });
  await form.getByLabel('Payee').fill('Oak Street Rentals');
  await form.getByLabel('Category', { exact: true }).selectOption({ label: 'Rent' });
  await form.getByLabel('Outflow').fill('1,800');
  await form.getByRole('button', { name: 'Add transaction' }).click();
}

test('schedules a monthly bill and enters it early', async ({ page, request }) => {
  const checking = await setUp(request);
  const due = daysFromToday(5);
  await page.goto(`/accounts/${checking.id}`);

  await addRepeating(page, due, 'Monthly');

  await expect(scheduled(page)).toContainText('Oak Street Rentals');
  await expect(scheduled(page)).toContainText('Monthly');
  await expect(scheduled(page)).toContainText(due);
  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('Working $3,000.00');

  await scheduled(page).getByRole('button', { name: 'Enter now' }).click();
  await expect(page.getByRole('row').filter({ hasText: due }).last()).toContainText('Rent');
  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('Working $1,200.00');
  await expect(scheduled(page)).not.toContainText(due);
});

test('posts a schedule starting today right away and keeps the next one', async ({
  page,
  request,
}) => {
  const checking = await setUp(request);
  await page.goto(`/accounts/${checking.id}`);

  await addRepeating(page, daysFromToday(0), 'Weekly');

  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('Working $1,200.00');
  await expect(scheduled(page)).toContainText(daysFromToday(7));
});

test('turns a future-dated transaction into a one-time scheduled transaction', async ({
  page,
  request,
}) => {
  const checking = await setUp(request);
  const due = daysFromToday(3);
  await page.goto(`/accounts/${checking.id}`);

  const form = page.getByRole('form', { name: 'Add transaction' });
  await form.getByLabel('Date').fill(due);
  await form.getByLabel('Payee').fill('Dentist');
  await form.getByLabel('Outflow').fill('120');
  await form.getByRole('button', { name: 'Add transaction' }).click();

  await expect(scheduled(page)).toContainText('Dentist');
  await expect(scheduled(page)).toContainText('Once');
  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('Working $3,000.00');
});

test('skips, edits and deletes scheduled transactions', async ({ page, request }) => {
  const checking = await setUp(request);
  const due = daysFromToday(5);
  await page.goto(`/accounts/${checking.id}`);
  await addRepeating(page, due, 'Weekly');
  await expect(scheduled(page)).toContainText(due);

  await scheduled(page).getByRole('button', { name: 'Skip' }).click();
  await expect(scheduled(page)).toContainText(daysFromToday(12));
  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('Working $3,000.00');

  await scheduled(page).getByRole('button', { name: 'Edit' }).click();
  const form = page.getByRole('form', { name: 'Edit scheduled transaction' });
  await expect(form.getByLabel('Repeat')).toHaveValue('weekly');
  await form.getByLabel('Repeat').selectOption({ label: 'Every other week' });
  await form.getByLabel('Outflow').fill('900');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(scheduled(page)).toContainText('Every other week');
  await expect(scheduled(page)).toContainText('-$900.00');

  await scheduled(page).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(scheduled(page)).toHaveCount(0);
});

test('Underfunded covers an upcoming scheduled bill', async ({ page, request }) => {
  const checking = await setUp(request);
  await page.goto(`/accounts/${checking.id}`);
  const laterThisMonth = daysFromToday(1);
  // Underfunded only counts this month's bills, so tomorrow must still be this month.
  test.skip(
    laterThisMonth.slice(0, 7) !== daysFromToday(0).slice(0, 7),
    'Runs on any day except the last of the month',
  );
  await addRepeating(page, laterThisMonth, 'Monthly');

  await page.getByRole('link', { name: 'Budget' }).click();
  await page.getByRole('button', { name: 'Auto-assign' }).click();
  const menu = page.getByRole('dialog', { name: 'Auto-assign' });
  await expect(menu.getByRole('button', { name: /Underfunded/ })).toContainText('$1,800.00');
  await menu.getByRole('button', { name: /Underfunded/ }).click();

  await expect(page.getByLabel('Assigned for Rent')).toHaveValue('1800.00');
});
