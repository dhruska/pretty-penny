import { HttpError } from '../routes/schemas.js';
import type { YnabPlan, YnabPlanSummary } from './types.js';

export const DEFAULT_YNAB_API_URL = 'https://api.ynab.com/v1';
export const YNAB_TOKEN_CODE = 'YNAB_TOKEN';

const TIMEOUT_MS = 120_000;

export type FetchFn = typeof fetch;

/** Turns YNAB's error responses into messages for the import page. The token is never included. */
function ynabError(status: number): HttpError {
  if (status === 401) {
    return new HttpError(
      400,
      'YNAB didn’t accept that token. Check it was copied in full, or create a new one.',
      YNAB_TOKEN_CODE,
    );
  }
  if (status === 404) return new HttpError(404, 'That plan wasn’t found in YNAB.');
  if (status === 429) {
    return new HttpError(
      429,
      'YNAB allows 200 requests an hour for each token. Try again in a while.',
    );
  }
  return new HttpError(502, `YNAB returned an error (${status}). Try again later.`);
}

/** Reads plans from YNAB's API with a personal access token, which is never stored. */
export function createYnabClient(baseUrl = DEFAULT_YNAB_API_URL, fetchFn: FetchFn = fetch) {
  async function get<T>(token: string, path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(502, 'Couldn’t reach YNAB. Check the internet connection and try again.');
    }
    if (!response.ok) throw ynabError(response.status);

    const body = (await response.json().catch(() => null)) as { data?: T } | null;
    if (!body?.data)
      throw new HttpError(502, 'YNAB sent a response the import doesn’t understand.');
    return body.data;
  }

  return {
    async listPlans(token: string): Promise<YnabPlanSummary[]> {
      const data = await get<{ plans?: YnabPlanSummary[] }>(token, '/plans');
      if (!Array.isArray(data.plans)) {
        throw new HttpError(502, 'YNAB sent a response the import doesn’t understand.');
      }
      return data.plans;
    },

    async getPlan(token: string, planId: string): Promise<YnabPlan> {
      const data = await get<{ plan?: YnabPlan }>(token, `/plans/${encodeURIComponent(planId)}`);
      const plan = data.plan;
      const lists = [
        'accounts',
        'payees',
        'category_groups',
        'categories',
        'months',
        'transactions',
        'subtransactions',
        'scheduled_transactions',
        'scheduled_subtransactions',
      ] as const;
      if (!plan || lists.some((key) => !Array.isArray(plan[key]))) {
        throw new HttpError(502, 'YNAB sent a response the import doesn’t understand.');
      }
      return plan;
    },
  };
}

export type YnabClient = ReturnType<typeof createYnabClient>;
