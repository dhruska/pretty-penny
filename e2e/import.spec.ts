import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resetDb } from './reset-db';

// Accepted by the fake YNAB server in support/fake-ynab.ts, which serves a made-up plan.
const TOKEN = 'fake-ynab-token';

test.beforeEach(() => resetDb());

test('imports a YNAB plan and compares it with YNAB', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Import your plan' }).click();
  await expect(page.getByRole('heading', { name: 'Import from YNAB' })).toBeVisible();

  const token = page.getByLabel('Personal access token');
  await token.fill('wrong-token');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('alert')).toContainText('YNAB didn’t accept that token');

  await token.fill(TOKEN);
  await page.getByRole('button', { name: 'Connect' }).click();

  const preview = page.getByRole('region', { name: 'Preview of Sample Plan' });
  await expect(preview).toContainText('6 accounts, 5 categories in 3 groups, 30 transactions');
  await expect(preview.getByRole('row', { name: /Mortgage/ })).toContainText(
    'Liability · Tracking',
  );
  await expect(preview.getByRole('row', { name: /Old Savings/ })).toContainText('(closed)');
  await expect(preview).toContainText('Credit card payment categories aren’t imported');
  await expect(preview).toContainText('Corner Market in Old Savings, next on Dec 1, 2026');

  await preview.getByRole('button', { name: 'Import' }).click();
  const report = page.getByRole('region', { name: 'Import report' });
  await expect(report).toContainText('Every account balance matches YNAB', { timeout: 30_000 });
  await expect(report).toContainText('Ready to Assign is $3,650.00 here and $3,660.00 in YNAB.');
  await expect(report).toContainText('-$50.00 most likely from credit card overspending');
  await expect(report).toContainText('Available matches YNAB in all 5 categories.');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    report.getByRole('button', { name: 'Download report' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^pretty-penny-import-report-\d{4}-\d{2}-\d{2}\.txt$/,
  );
  expect(await readFile((await download.path())!, 'utf8')).toContain(
    'OK   Mortgage: -$299,000.00 / -$299,000.00',
  );

  await report.getByRole('link', { name: 'Go to the budget' }).click();
  const sidebar = page.getByRole('complementary', { name: 'Accounts' });
  await expect(sidebar.getByRole('link', { name: /Checking/ })).toContainText('$7,880.00');
  await expect(page.getByRole('link', { name: 'Import your plan' })).toHaveCount(0);

  await sidebar.getByRole('link', { name: 'Import from YNAB' }).click();
  await expect(page.getByText('Importing only works on an empty budget')).toBeVisible();
});
