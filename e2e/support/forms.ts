import type { Page } from '@playwright/test';

/** The add-transaction form on an account page, opening it first if it's closed. */
export async function openAddForm(page: Page) {
  const form = page.getByRole('form', { name: 'Add transaction' });
  if (!(await form.isVisible())) {
    await page.getByRole('button', { name: 'Add transaction' }).click();
  }
  await form.waitFor();
  return form;
}
