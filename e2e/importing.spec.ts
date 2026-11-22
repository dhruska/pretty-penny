import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resetDb } from './reset-db';
import {
  addBankTransaction,
  fakePlaidLink,
  removeBankTransaction,
  resetPlaid,
} from './support/plaid';

// Made-up transactions at the fake Northwind Bank, imported into Household Checking.

test.beforeEach(async ({ page }) => {
  await resetDb();
  await resetPlaid();
  await fakePlaidLink(page);
});

/** A date some days before today, as YYYY-MM-DD in local time. */
function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Household Checking with Corner Market entered 6 days ago, so importing starts 9 days ago,
 * linked to the fake bank's checking account once the bank's transactions are added.
 */
async function setUp(request: APIRequestContext, addTransactions: () => Promise<void>) {
  const account = await (
    await request.post('/api/accounts', {
      data: {
        name: 'Household Checking',
        type: 'checking',
        startingBalanceCents: 100000,
        date: daysAgo(30),
      },
    })
  ).json();
  await request.post(`/api/accounts/${account.id}/transactions`, {
    data: { date: daysAgo(6), payee: 'Corner Market', amountCents: -4250 },
  });
  const connection = await (
    await request.post('/api/bank/connections', {
      data: { publicToken: 'public-sandbox-northwind', institutionName: 'Northwind Bank' },
    })
  ).json();
  await addTransactions();
  await request.put(`/api/bank/accounts/${connection.accounts[0].id}/link`, {
    data: { accountId: account.id },
  });
  return { accountId: account.id as number, bankAccountId: connection.accounts[0].id as number };
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Accounts' });
const row = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

test('reviews imports: approve, approve all, reject with undo, and the budget’s notice', async ({
  page,
  request,
}) => {
  const { accountId } = await setUp(request, async () => {
    await addBankTransaction({
      id: 'grocer',
      amount: 61.2,
      date: daysAgo(2),
      name: 'GREENLEAF #22',
      merchant_name: 'Greenleaf Grocery',
    });
    await addBankTransaction({
      id: 'pay',
      amount: -2500,
      date: daysAgo(1),
      name: 'PAYROLL DEPOSIT',
    });
    await addBankTransaction({ id: 'books', amount: 18, date: daysAgo(1), name: 'BOOKSHOP' });
  });

  await page.goto('/');
  await expect(page.getByRole('link', { name: '3 transactions need review' })).toBeVisible();
  await expect(sidebar(page).getByRole('img', { name: '3 to review' })).toBeVisible();

  await page.goto(`/accounts/${accountId}`);
  const banner = page.getByRole('region', { name: 'Needs review' });
  await expect(banner).toContainText('3 transactions need review');
  await expect(row(page, 'Greenleaf Grocery')).toContainText('$61.20');

  await page.getByRole('button', { name: 'Approve Greenleaf Grocery' }).click();
  await expect(banner).toContainText('2 transactions need review');

  // Review shows only those still needing it.
  await banner.getByRole('button', { name: 'Review' }).click();
  await expect(row(page, 'Greenleaf Grocery')).toHaveCount(0);
  await expect(row(page, 'PAYROLL DEPOSIT')).toBeVisible();

  // Reject, with undo.
  await row(page, 'BOOKSHOP').hover();
  await row(page, 'BOOKSHOP').getByRole('button', { name: 'Reject' }).click();
  await expect(row(page, 'BOOKSHOP')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'BOOKSHOP')).toBeVisible();

  await banner.getByRole('button', { name: 'Approve all' }).click();
  await expect(page.getByText('2 transactions approved')).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(sidebar(page).getByRole('img', { name: /to review/ })).toHaveCount(0);
  await expect(row(page, 'Corner Market')).toBeVisible();
});

test('approves by saving an edit, and finds imports needing review', async ({ page, request }) => {
  await setUp(request, async () => {
    await addBankTransaction({ id: 'grocer', amount: 61.2, date: daysAgo(2), name: 'GREENLEAF' });
    await addBankTransaction({
      id: 'pay',
      amount: -2500,
      date: daysAgo(1),
      name: 'PAYROLL DEPOSIT',
    });
  });

  await page.goto('/');
  await page.getByRole('link', { name: '2 transactions need review' }).click();
  await expect(page.getByLabel('Review', { exact: true })).toHaveValue('true');
  await expect(page.getByLabel('Results summary')).toContainText('2 transactions');

  await row(page, 'GREENLEAF').getByRole('cell', { name: 'GREENLEAF', exact: true }).click();
  await page.getByLabel('Memo').fill('weekly shop');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Results summary')).toContainText('1 transaction');
});

test('shows matches, unmatches them, and keeps pending transactions apart', async ({
  page,
  request,
}) => {
  const { accountId } = await setUp(request, async () => {
    await addBankTransaction({
      id: 'market',
      amount: 42.5,
      date: daysAgo(5),
      name: 'CORNER MKT 0042',
    });
    await addBankTransaction({
      id: 'cafe',
      amount: 15,
      date: daysAgo(0),
      name: 'CAFE LUMEN',
      pending: true,
    });
  });

  await page.goto(`/accounts/${accountId}`);
  const market = row(page, 'Corner Market');
  await expect(
    market.getByRole('img', { name: 'Matched with Northwind Bank: “CORNER MKT 0042”' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Needs review' })).toHaveCount(0);

  const pending = page.getByRole('group').filter({ hasText: 'Pending (1)' });
  await pending.getByText('Pending (1)').click();
  await expect(page.getByRole('list', { name: 'Pending transactions' })).toContainText(
    'CAFE LUMEN',
  );
  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('Working $957.50');

  await market.hover();
  await market.getByRole('button', { name: 'Unmatch' }).click();
  await expect(page.getByText('Unmatched. The import needs review on its own.')).toBeVisible();
  await expect(row(page, 'CORNER MKT 0042')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Needs review' })).toContainText(
    '1 transaction needs review',
  );

  // Once posted, the pending one arrives as an import.
  await removeBankTransaction('cafe');
  await addBankTransaction({
    id: 'cafe-posted',
    amount: 15.75,
    date: daysAgo(0),
    name: 'CAFE LUMEN',
  });
  await page.getByRole('button', { name: 'Import now' }).click();
  await expect(page.getByText('Pending (1)')).toHaveCount(0);
  await expect(row(page, 'CAFE LUMEN')).toContainText('$15.75');
});

test('moves where importing starts', async ({ page, request }) => {
  const { accountId } = await setUp(request, async () => {
    await addBankTransaction({ id: 'early', amount: 7, date: daysAgo(20), name: 'EARLY SHOP' });
  });

  await page.goto('/bank');
  const checking = page.getByRole('listitem').filter({ hasText: 'Everyday Checking ••1234' });
  await expect(checking).toContainText('Importing from');
  await checking.getByRole('button', { name: 'Change' }).click();
  await checking.getByLabel('Import from').fill(daysAgo(25));
  await checking.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^Importing from /).first()).toBeVisible();

  await page.goto(`/accounts/${accountId}`);
  await expect(row(page, 'EARLY SHOP')).toBeVisible();
});
