import { expect, test } from '@playwright/test';
import { TEST_PASSWORD } from '../global-setup';

test.use({ storageState: { cookies: [], origins: [] } });

test('signs in and out on a phone', async ({ page }) => {
  await page.goto('/');
  const form = page.getByRole('form', { name: 'Sign in' });
  await form.getByLabel('Password').fill(TEST_PASSWORD);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
});
