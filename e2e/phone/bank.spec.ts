import { expect, test, type Page } from '@playwright/test';
import { resetDb } from '../reset-db';
import { fakePlaidLink, resetPlaid } from '../support/plaid';

test.beforeEach(async ({ page }) => {
  await resetDb();
  await resetPlaid();
  await fakePlaidLink(page);
});

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('connects a bank and adds an account from it, without scrolling sideways', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('dialog', { name: 'Pretty Penny' })
    .getByRole('link', { name: 'Bank connections' })
    .click();

  await page.getByRole('button', { name: 'Connect a bank' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link Northwind Bank accounts' });
  const card = dialog.getByRole('listitem').filter({ hasText: 'Northwind Rewards Card ••9876' });
  await card.getByLabel('Linked to').selectOption({ label: 'New account…' });
  await card.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByText('Northwind Rewards Card added and linked')).toBeVisible();
  await expectNoSidewaysScroll(page);
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('region', { name: 'Northwind Bank' })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('dialog', { name: 'Pretty Penny' })
    .getByRole('link', { name: /Northwind Rewards Card/ })
    .click();
  await expect(page.getByRole('region', { name: 'Bank' })).toContainText(
    'Northwind Bank ••9876 -$312.45',
  );
  await expectNoSidewaysScroll(page);
});
