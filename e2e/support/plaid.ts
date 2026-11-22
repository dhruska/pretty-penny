import type { Page } from '@playwright/test';

export const FAKE_PLAID_URL = `http://127.0.0.1:${process.env.FAKE_PLAID_PORT ?? 3103}`;

/** Clears the fake Plaid server's connections, as resetDb clears the database. */
export async function resetPlaid() {
  await fetch(`${FAKE_PLAID_URL}/fake/reset`, { method: 'POST' });
}

/** Makes every connection at the fake bank want you to sign in again, or stop wanting it. */
export async function setLoginRequired(on: boolean) {
  await fetch(`${FAKE_PLAID_URL}/fake/login-required`, {
    method: 'POST',
    body: JSON.stringify({ on }),
  });
}

/**
 * Stands in for Plaid's sign-in window, loaded from Plaid's site in real use. It finishes at
 * once, as though you signed in to the made-up Northwind Bank.
 */
export async function fakePlaidLink(page: Page) {
  await page.route('https://cdn.plaid.com/link/v2/stable/link-initialize.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.Plaid = {
        create(config) {
          return {
            open() {
              window.__plaidOpened = (window.__plaidOpened || 0) + 1;
              setTimeout(() => config.onSuccess('public-sandbox-northwind', {
                institution: { name: 'Northwind Bank' },
              }), 0);
            },
            destroy() {},
          };
        },
      };`,
    }),
  );
}
