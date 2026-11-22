/**
 * Plaid's sign-in window, loaded from Plaid's site when first needed. Banks that sign you in on
 * their own site send you back to /bank/oauth, which resumes the same window, so what it was
 * doing is remembered on this device until it finishes.
 */
export const PLAID_SCRIPT_URL = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}

interface PlaidExitError {
  error_message?: string;
  display_message?: string | null;
}

interface PlaidConfig {
  token: string;
  receivedRedirectUri?: string;
  onSuccess: (publicToken: string, metadata: { institution?: { name?: string } | null }) => void;
  onExit: (error: PlaidExitError | null) => void;
}

declare global {
  interface Window {
    Plaid?: { create: (config: PlaidConfig) => PlaidHandler };
  }
}

let loading: Promise<NonNullable<Window['Plaid']>> | null = null;

function loadPlaid(): Promise<NonNullable<Window['Plaid']>> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PLAID_SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.Plaid ? resolve(window.Plaid) : reject(new Error('Plaid’s sign-in didn’t load.'));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Couldn’t load Plaid’s sign-in. Check the internet connection.'));
    };
    document.head.append(script);
  });
  return loading;
}

/** What the sign-in window is doing: connecting a new bank, or fixing a connection. */
export interface PendingLink {
  token: string;
  connectionId: number | null;
}

const PENDING_KEY = 'pretty-penny.plaid-link';

export function savePendingLink(pending: PendingLink) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Without storage, banks that send you back to the app can't resume; others still work.
  }
}

export function readPendingLink(): PendingLink | null {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as PendingLink | null;
    return value && typeof value.token === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function clearPendingLink() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
}

export interface LinkResult {
  publicToken: string;
  institutionName: string | undefined;
}

/**
 * Opens the sign-in window and resolves when it finishes: with the result, or null if it was
 * closed. Rejects with Plaid's message if the bank refused.
 */
export async function openPlaidLink(
  token: string,
  receivedRedirectUri?: string,
): Promise<LinkResult | null> {
  const plaid = await loadPlaid();
  return new Promise((resolve, reject) => {
    const handler = plaid.create({
      token,
      ...(receivedRedirectUri && { receivedRedirectUri }),
      onSuccess: (publicToken, metadata) => {
        handler.destroy();
        resolve({ publicToken, institutionName: metadata.institution?.name ?? undefined });
      },
      onExit: (error) => {
        handler.destroy();
        if (error)
          reject(
            new Error(error.display_message || error.error_message || 'Plaid’s sign-in stopped.'),
          );
        else resolve(null);
      },
    });
    handler.open();
  });
}
