import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import type { YnabClient } from '../ynab/client.js';
import { compareWithYnab } from '../ynab/compare.js';
import { isDatabaseEmpty, runImport } from '../ynab/importer.js';
import { planImport } from '../ynab/mapping.js';
import { HttpError } from './schemas.js';

interface TokenBody {
  token: string;
}

interface PlanBody extends TokenBody {
  planId: string;
}

const token = { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' } as const;
const planId = { type: 'string', minLength: 1, maxLength: 100 } as const;

const tokenSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['token'],
    properties: { token },
  },
};

const planSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'planId'],
    properties: { token, planId },
  },
};

const NOT_EMPTY_MESSAGE =
  'Importing only works on an empty budget, so it can’t mix with or duplicate existing data.';

/**
 * A one-time import of a YNAB plan through YNAB's API. The personal access token arrives with each
 * request, is passed straight to YNAB, and is never stored or logged.
 */
export function registerImportRoutes(
  app: FastifyInstance,
  db: Db,
  ynab: YnabClient,
  today: () => string,
) {
  app.get('/api/import/status', async () => ({ canImport: await isDatabaseEmpty(db) }));

  app.post<{ Body: TokenBody }>(
    '/api/import/ynab/plans',
    { schema: tokenSchema },
    async (request) => {
      const plans = await ynab.listPlans(request.body.token.trim());
      return {
        plans: plans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          lastModifiedOn: plan.last_modified_on ?? null,
        })),
      };
    },
  );

  app.post<{ Body: PlanBody }>(
    '/api/import/ynab/preview',
    { schema: planSchema },
    async (request) => {
      if (!(await isDatabaseEmpty(db))) throw new HttpError(409, NOT_EMPTY_MESSAGE);
      const plan = await ynab.getPlan(request.body.token.trim(), request.body.planId);
      return planImport(plan).preview;
    },
  );

  app.post<{ Body: PlanBody }>('/api/import/ynab', { schema: planSchema }, async (request) => {
    const ynabPlan = await ynab.getPlan(request.body.token.trim(), request.body.planId);
    const plan = planImport(ynabPlan);
    if (plan.preview.problems.length > 0) throw new HttpError(400, plan.preview.problems[0]!);

    return db.transaction(async (tx) => {
      // Holding this lock makes a second import wait, then see the data and refuse.
      await tx.execute(sql`lock table accounts in exclusive mode`);
      if (!(await isDatabaseEmpty(tx))) throw new HttpError(409, NOT_EMPTY_MESSAGE);

      const result = await runImport(tx, plan);
      return compareWithYnab(tx, ynabPlan, plan, result, today().slice(0, 7));
    });
  });
}
