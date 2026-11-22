import { expect, test, type Page } from '@playwright/test';
import { resetDb } from '../reset-db';
import { addBankTransaction, resetPlaid } from '../support/plaid';

test.beforeEach(async () => {
  await resetDb();
  await resetPlaid();
});

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('reviews imports on a phone: approve, and reject from the edit view', async ({
  page,
  request,
}) => {
  const account = await (
    await request.post('/api/accounts', {
      data: {
        name: 'Household Checking',
        type: 'checking',
        startingBalanceCents: 0,
        date: today(),
      },
    })
  ).json();
  const connection = await (
    await request.post('/api/bank/connections', {
      data: { publicToken: 'public-sandbox-northwind', institutionName: 'Northwind Bank' },
    })
  ).json();
  await addBankTransaction({
    id: 'grocer',
    amount: 61.2,
    date: today(),
    name: 'GREENLEAF GROCERY STORE 0022',
  });
  await addBankTransaction({ id: 'books', amount: 18, date: today(), name: 'BOOKSHOP' });
  await request.put(`/api/bank/accounts/${connection.accounts[0].id}/link`, {
    data: { accountId: account.id },
  });

  await page.goto('/');
  await page.getByRole('link', { name: '2 transactions need review' }).click();
  await expect(page.getByRole('list', { name: 'Transactions' })).toContainText('BOOKSHOP');
  await expectNoSidewaysScroll(page);

  await page.goto(`/accounts/${account.id}`);
  await expect(page.getByRole('region', { name: 'Needs review' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve GREENLEAF GROCERY STORE 0022' }).click();
  await expect(page.getByRole('region', { name: 'Needs review' })).toContainText(
    '1 transaction needs review',
  );
  await expectNoSidewaysScroll(page);

  await page.getByRole('button', { name: /^Edit BOOKSHOP/ }).click();
  await expect(page.getByText('From Northwind Bank: “BOOKSHOP”')).toBeVisible();
  await page.getByRole('button', { name: 'Reject transaction' }).click();
  await expect(page.getByRole('list', { name: 'Transactions' })).not.toContainText('BOOKSHOP');
  await expect(page.getByRole('region', { name: 'Needs review' })).toHaveCount(0);
});
