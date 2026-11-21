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
