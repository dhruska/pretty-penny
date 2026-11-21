import { expect, test, type APIRequestContext } from '@playwright/test';
import { resetDb } from './reset-db';
import { openAddForm } from './support/forms';

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

test('flags a transaction, names the color and filters by it', async ({ page, request }) => {
  const checking = await post<{ id: number }>(request, '/api/accounts', {
    name: 'Checking',
    startingBalanceCents: 1_000_00,
    date: thisMonthDate(1),
  });
  for (const payee of ['Hardware Store', 'Corner Market']) {
    await post(request, `/api/accounts/${checking.id}/transactions`, {
      date: thisMonthDate(2),
      payee,
      amountCents: -25_00,
    });
  }
  await page.goto(`/accounts/${checking.id}`);

  const hardware = page.getByRole('row').filter({ hasText: 'Hardware Store' });
  await hardware.getByRole('button', { name: 'Flag: No flag' }).click();
  await page.getByRole('group', { name: 'Flag' }).getByRole('button', { name: 'Blue' }).click();
  await expect(hardware.getByRole('button', { name: 'Flag: Blue' })).toBeVisible();

  // Naming the color changes it everywhere.
  await hardware.getByRole('button', { name: 'Flag: Blue' }).click();
  await page.getByRole('button', { name: 'Edit names' }).click();
  const names = page.getByRole('form', { name: 'Flag names' });
  await names.getByLabel('Blue name').fill('Reimbursable');
  await names.getByRole('button', { name: 'Save names' }).click();
  await expect(hardware.getByRole('button', { name: 'Flag: Reimbursable' })).toBeVisible();

  // New transactions can be flagged from the form.
  const form = await openAddForm(page);
  await form.getByLabel('Payee').fill('Pharmacy');
  await form.getByLabel('Outflow').fill('8');
  await form.getByRole('button', { name: 'Flag: No flag' }).click();
  await page.getByRole('group', { name: 'Flag' }).getByRole('button', { name: 'Red' }).click();
  await form.getByRole('button', { name: 'Add transaction' }).click();
  const pharmacy = page.getByRole('row').filter({ hasText: 'Pharmacy' });
  await expect(pharmacy.getByRole('button', { name: 'Flag: Red' })).toBeVisible();

  await page.getByRole('link', { name: 'All transactions' }).click();
  await page.getByLabel('Flag', { exact: true }).selectOption({ label: 'Reimbursable' });
  await expect(page.getByLabel('Results summary')).toContainText('1 transaction');
  await expect(page.getByRole('row').filter({ hasText: 'Hardware Store' })).toBeVisible();
  await page.getByLabel('Flag', { exact: true }).selectOption({ label: 'Flagged' });
  await expect(page.getByLabel('Results summary')).toContainText('2 transactions');

  // Clearing a flag takes it out of the filtered list.
  await page
    .getByRole('row')
    .filter({ hasText: 'Pharmacy' })
    .getByRole('button', { name: 'Flag: Red' })
    .click();
  await page.getByRole('group', { name: 'Flag' }).getByRole('button', { name: 'No flag' }).click();
  await expect(page.getByLabel('Results summary')).toContainText('1 transaction');
});
