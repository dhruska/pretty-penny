import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resetDb } from './reset-db';
import { fakePlaidLink, resetPlaid, setLoginRequired } from './support/plaid';

// The fake Plaid server in support/fake-plaid.ts has one made-up bank, Northwind Bank, with
// Everyday Checking ••1234 at $2,450.00 and Northwind Rewards Card ••9876 owing $312.45.

test.beforeEach(async ({ page }) => {
  await resetDb();
  await resetPlaid();
  await fakePlaidLink(page);
});

async function createAccount(
  request: APIRequestContext,
  name: string,
  startingBalanceCents: number,
) {
  const response = await request.post('/api/accounts', {
    data: { name, type: 'checking', startingBalanceCents, date: '2026-11-01' },
  });
  return ((await response.json()) as { id: number }).id;
}

/** Connects the fake bank without the page, and links its checking account. */
async function connectAndLink(request: APIRequestContext, accountId: number) {
  const response = await request.post('/api/bank/connections', {
    data: { publicToken: 'public-sandbox-northwind', institutionName: 'Northwind Bank' },
  });
  const connection = (await response.json()) as { id: number; accounts: { id: number }[] };
  await request.put(`/api/bank/accounts/${connection.accounts[0]!.id}/link`, {
    data: { accountId },
  });
  return connection.id;
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Accounts' });

test('connects a bank, links one account and adds another from it', async ({ page, request }) => {
  await createAccount(request, 'Household Checking', 240000);
  await page.goto('/');
  await sidebar(page).getByRole('link', { name: 'Bank connections' }).click();

  await expect(page.getByRole('heading', { name: 'Bank connections' })).toBeVisible();
  await expect(page.getByText('Using Plaid’s Sandbox')).toBeVisible();
  await expect(page.getByText('No banks connected')).toBeVisible();
  await page.getByRole('button', { name: 'Connect a bank' }).click();

  const dialog = page.getByRole('dialog', { name: 'Link Northwind Bank accounts' });
  await expect(dialog).toBeVisible();
  const checking = dialog.getByRole('listitem').filter({ hasText: 'Everyday Checking ••1234' });
  await expect(checking).toContainText('$2,450.00');
  await checking.getByLabel('Linked to').selectOption({ label: 'Household Checking' });
  await expect(
    page.getByText('Everyday Checking ••1234 linked to Household Checking'),
  ).toBeVisible();

  const card = dialog.getByRole('listitem').filter({ hasText: 'Northwind Rewards Card ••9876' });
  await expect(card).toContainText('-$312.45');
  await card.getByLabel('Linked to').selectOption({ label: 'New account…' });
  const form = card.getByRole('form', { name: 'New account for Northwind Rewards Card ••9876' });
  await expect(form.getByLabel('Account name')).toHaveValue('Northwind Rewards Card');
  await expect(form.getByLabel('Account type')).toHaveValue('credit_card');
  await form.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByText('Northwind Rewards Card added and linked')).toBeVisible();
  await expect(card.getByLabel('Linked to')).toHaveValue(/\d+/);
  await dialog.getByRole('button', { name: 'Done' }).click();

  const connection = page.getByRole('region', { name: 'Northwind Bank' });
  await expect(connection).toContainText('Updated just now');
  await expect(
    connection
      .getByRole('listitem')
      .filter({ hasText: '••1234' })
      .getByLabel('Linked to')
      .locator('option:checked'),
  ).toHaveText('Household Checking');

  // The new account starts at the bank's balance.
  await sidebar(page)
    .getByRole('link', { name: /Northwind Rewards Card/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Northwind Rewards Card' })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: /Northwind Rewards Card/ })).toContainText(
    '-$312.45',
  );

  // The linked account shows the bank's balance, $50 above what's cleared.
  await sidebar(page)
    .getByRole('link', { name: /Household Checking/ })
    .click();
  const bank = page.getByRole('region', { name: 'Bank' });
  await expect(bank).toContainText('Northwind Bank ••1234 $2,450.00');
  await expect(bank).toContainText('$50.00 more than your cleared balance');

  // Reconciling mentions that balance, and a "No" starts from it; "Yes" never adjusts.
  await page.getByRole('button', { name: 'Reconcile' }).click();
  await expect(page.getByRole('note')).toHaveText(
    'Northwind Bank says $2,450.00, which is $50.00 more.',
  );
  await page.getByRole('button', { name: 'No' }).click();
  await expect(page.getByLabel('Bank balance')).toHaveValue('2450.00');
});

test('shows a connection that needs signing in again, and fixes it', async ({ page, request }) => {
  const accountId = await createAccount(request, 'Household Checking', 245000);
  const connectionId = await connectAndLink(request, accountId);
  await setLoginRequired(true);
  await request.post(`/api/bank/connections/${connectionId}/refresh`);

  await page.goto(`/accounts/${accountId}`);
  await expect(
    sidebar(page).getByRole('img', { name: 'Bank connection needs fixing' }),
  ).toBeVisible();
  const warning = page.getByRole('region', { name: 'Bank' }).getByRole('alert');
  await expect(warning).toContainText('Northwind Bank needs you to sign in again.');
  // In balance with the bank, so no difference is shown.
  await expect(page.getByRole('region', { name: 'Bank' })).not.toContainText('cleared balance');

  await warning.getByRole('link', { name: 'Bank connections' }).click();
  const connection = page.getByRole('region', { name: 'Northwind Bank' });
  await expect(connection.getByRole('alert')).toContainText('needs you to sign in again');

  await setLoginRequired(false);
  await connection.getByRole('button', { name: 'Fix connection' }).click();
  await expect(page.getByText('Northwind Bank fixed')).toBeVisible();
  await expect(connection.getByRole('alert')).toHaveCount(0);
  await expect(
    sidebar(page).getByRole('img', { name: 'Bank connection needs fixing' }),
  ).toHaveCount(0);
});

test('links and unlinks from Edit account', async ({ page, request }) => {
  const accountId = await createAccount(request, 'Household Checking', 0);
  await request.post('/api/bank/connections', {
    data: { publicToken: 'public-sandbox-northwind', institutionName: 'Northwind Bank' },
  });

  await page.goto(`/accounts/${accountId}`);
  await page.getByRole('button', { name: 'Edit account' }).click();
  const section = page.getByRole('dialog').getByRole('region', { name: 'Bank' });
  await section
    .getByLabel('Bank account')
    .selectOption({ label: 'Northwind Bank: Everyday Checking ••1234' });
  await section.getByRole('button', { name: 'Link' }).click();
  await expect(section).toContainText('Linked to Northwind Bank ••1234');

  await section.getByRole('button', { name: 'Unlink' }).click();
  await expect(section.getByLabel('Bank account')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Bank' })).toHaveCount(0);
});

test('removes a connection, keeping its accounts', async ({ page, request }) => {
  const accountId = await createAccount(request, 'Household Checking', 245000);
  await connectAndLink(request, accountId);

  await page.goto('/bank');
  await page.getByRole('button', { name: 'Remove connection' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('the login it used isn’t given back');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove connection' }).click();
  await expect(page.getByText('Northwind Bank removed')).toBeVisible();
  await expect(page.getByText('No banks connected')).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: /Household Checking/ })).toContainText(
    '$2,450.00',
  );
});

test('finishes a sign-in after the bank sends you back', async ({ page }) => {
  await page.goto('/bank/oauth');
  await expect(page.getByRole('alert')).toContainText('This bank sign-in has expired');

  // As though Connect a bank sent you to the bank's site, which sent you back here.
  const { linkToken } = await (
    await page.request.post('/api/bank/link-token', { data: {} })
  ).json();
  await page.evaluate(
    (token) =>
      localStorage.setItem(
        'pretty-penny.plaid-link',
        JSON.stringify({ token, connectionId: null }),
      ),
    linkToken,
  );
  await page.goto('/bank/oauth?oauth_state_id=fake-state');
  await expect(page).toHaveURL(/\/bank$/);
  await expect(page.getByRole('dialog', { name: 'Link Northwind Bank accounts' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pretty-penny.plaid-link'))).toBeNull();
});

test('explains what to set up when Plaid isn’t configured', async ({ page }) => {
  await page.route('/api/bank/status', (route) =>
    route.fulfill({
      json: {
        configured: false,
        environment: null,
        problems: ['PLAID_CLIENT_ID isn’t set.', 'BANK_TOKEN_KEY isn’t set.'],
      },
    }),
  );
  await page.goto('/bank');
  await expect(page.getByText('Bank sync isn’t set up')).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'BANK_TOKEN_KEY isn’t set.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect a bank' })).toHaveCount(0);
});
