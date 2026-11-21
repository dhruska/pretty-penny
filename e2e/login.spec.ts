import { expect, test } from '@playwright/test';
import { TEST_PASSWORD } from './global-setup';

// These tests start signed out, unlike the rest.
test.use({ storageState: { cookies: [], origins: [] } });

test('signs in, returns to the page asked for, and signs out', async ({ page }) => {
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/login\?next=%2Freports$/);

  const form = page.getByRole('form', { name: 'Sign in' });
  await form.getByLabel('Password').fill('not the password');
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(form.getByRole('alert')).toHaveText('That password isn’t right.');
  await expect(form.getByLabel('Password')).toHaveValue('');

  await form.getByLabel('Password').fill(TEST_PASSWORD);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
});

test('never sends you to another site after signing in', async ({ page }) => {
  await page.goto('/login?next=//evil.example');
  const form = page.getByRole('form', { name: 'Sign in' });
  await form.getByLabel('Password').fill(TEST_PASSWORD);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
});
