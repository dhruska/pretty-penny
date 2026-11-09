import { expect, test } from '@playwright/test';

test('home page shows the message from the API', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Hello from Pretty Penny')).toBeVisible();
});
