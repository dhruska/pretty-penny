import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AccountType } from '../account-types.js';
import { decryptToken, encryptToken } from '../bank/crypto.js';
import { PlaidError } from '../bank/plaid.js';
import {
  type BankConfig,
  listConnections,
  nextDay,
  refreshConnection,
  requireBank,
  saveBankAccounts,
  toHttpError,
} from '../bank/service.js';
import type { Db } from '../db/client.js';
import { accounts, bankAccounts, bankConnections } from '../db/schema.js';
import { insertAccount } from './accounts.js';
import { accountName, accountType, HttpError, idParams, type IdParams } from './schemas.js';

const MAX_ID = 2_147_483_647;

/** Plaid errors meaning it has already forgotten the connection, so removing it can go ahead. */
const ALREADY_REMOVED = new Set(['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN']);

export function registerBankRoutes(
  app: FastifyInstance,
  db: Db,
  config: BankConfig,
  today: () => string,
) {
  async function findConnection(id: number) {
    const [connection] = await db.select().from(bankConnections).where(eq(bankConnections.id, id));
    if (!connection) throw new HttpError(404, 'Bank connection not found');
    return connection;
  }

  async function findBankAccount(id: number) {
    const [bankAccount] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id));
    if (!bankAccount) throw new HttpError(404, 'Bank account not found');
    return bankAccount;
  }

  async function connectionView(id: number) {
    return (await listConnections(db)).find((connection) => connection.id === id)!;
  }

  /** Whether bank sync is set up, and if not, what's missing from .env. */
  app.get('/api/bank/status', async () => ({
    configured: config.plaid !== null && config.key !== null,
    environment: config.plaid?.environment ?? null,
    problems: config.problems,
  }));

  app.get('/api/bank/connections', async () => listConnections(db));

  /** Starts Plaid's sign-in window, to connect a bank or, with a connection, to fix it. */
  app.post<{ Body: { connectionId?: number } }>(
    '/api/bank/link-token',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { connectionId: { type: 'integer', minimum: 1, maximum: MAX_ID } },
        },
      },
    },
    async (request) => {
      const { plaid, key } = requireBank(config);
      const { connectionId } = request.body;
      const accessToken = connectionId
        ? decryptToken(key, (await findConnection(connectionId)).accessTokenEncrypted)
        : undefined;
      try {
        return {
          linkToken: await plaid.createLinkToken({ accessToken, redirectUri: config.redirectUri }),
        };
      } catch (error) {
        throw toHttpError(error);
      }
    },
  );

  /** Saves a bank connected in Plaid's sign-in window, with its accounts. */
  app.post<{ Body: { publicToken: string; institutionName?: string } }>(
    '/api/bank/connections',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['publicToken'],
          properties: {
            publicToken: { type: 'string', minLength: 1, maxLength: 500 },
            institutionName: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { plaid, key } = requireBank(config);
      const institutionName = request.body.institutionName?.trim() || 'Bank';

      let exchanged: { accessToken: string; itemId: string };
      try {
        exchanged = await plaid.exchangePublicToken(request.body.publicToken);
      } catch (error) {
        throw toHttpError(error);
      }

      try {
        const plaidAccounts = await plaid.getAccounts(exchanged.accessToken);
        const id = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(bankConnections)
            .values({
              plaidItemId: exchanged.itemId,
              accessTokenEncrypted: encryptToken(key, exchanged.accessToken),
              institutionName,
              updatedAt: new Date(),
            })
            .returning({ id: bankConnections.id });
          await saveBankAccounts(tx, created!.id, plaidAccounts);
          return created!.id;
        });
        return reply.code(201).send(await connectionView(id));
      } catch (error) {
        // Without a saved token the connection could never be removed, so end it at Plaid now.
        await plaid.removeItem(exchanged.accessToken).catch(() => {});
        throw toHttpError(error);
      }
    },
  );

  /** Fetches the latest balances, and checks the connection still works, such as after fixing it. */
  app.post<{ Params: IdParams }>(
    '/api/bank/connections/:id/refresh',
    { schema: { params: idParams } },
    async (request) => {
      await refreshConnection(db, config, await findConnection(request.params.id));
      return connectionView(request.params.id);
    },
  );

  /** Ends Plaid's access to the bank. Linked accounts keep their transactions, as in YNAB. */
  app.delete<{ Params: IdParams }>(
    '/api/bank/connections/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const { plaid, key } = requireBank(config);
      const connection = await findConnection(request.params.id);
      try {
        await plaid.removeItem(decryptToken(key, connection.accessTokenEncrypted));
      } catch (error) {
        if (!(error instanceof PlaidError && ALREADY_REMOVED.has(error.errorCode))) {
          throw toHttpError(error);
        }
      }
      await db.delete(bankConnections).where(eq(bankConnections.id, connection.id));
      return reply.code(204).send();
    },
  );

  /** Links a bank account to a Pretty Penny account, or unlinks it with null. */
  app.put<{ Params: IdParams; Body: { accountId: number | null } }>(
    '/api/bank/accounts/:id/link',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['accountId'],
          properties: {
            accountId: { type: ['integer', 'null'], minimum: 1, maximum: MAX_ID },
          },
        },
      },
    },
    async (request) => {
      const bankAccount = await findBankAccount(request.params.id);
      const { accountId } = request.body;

      if (accountId !== null) {
        const [account] = await db
          .select({ name: accounts.name, closedAt: accounts.closedAt })
          .from(accounts)
          .where(eq(accounts.id, accountId));
        if (!account) throw new HttpError(404, 'Account not found');
        if (account.closedAt) throw new HttpError(409, 'Reopen this account before linking it.');

        const [other] = await db
          .select({ name: bankAccounts.name, mask: bankAccounts.mask })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.accountId, accountId), ne(bankAccounts.id, bankAccount.id)));
        if (other) {
          throw new HttpError(
            409,
            `${account.name} is already linked to ${other.name}${other.mask ? ` ••${other.mask}` : ''}. Unlink that first.`,
          );
        }
      }

      await db
        .update(bankAccounts)
        .set({ accountId, importFrom: null })
        .where(eq(bankAccounts.id, bankAccount.id));
      return connectionView(bankAccount.connectionId);
    },
  );

  /**
   * Creates a Pretty Penny account for a bank account and links them. As in YNAB, it starts with
   * the bank's balance today, and importing starts the day after.
   */
  app.post<{ Params: IdParams; Body: { name: string; type: AccountType } }>(
    '/api/bank/accounts/:id/create-account',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'type'],
          properties: { name: accountName, type: accountType },
        },
      },
    },
    async (request, reply) => {
      const bankAccount = await findBankAccount(request.params.id);
      if (bankAccount.accountId !== null) {
        throw new HttpError(409, 'This bank account is already linked. Unlink it first.');
      }
      const date = today();
      const account = await db.transaction(async (tx) => {
        const created = await insertAccount(tx, {
          name: request.body.name,
          type: request.body.type,
          startingBalanceCents: bankAccount.balanceCents ?? 0,
          date,
        });
        await tx
          .update(bankAccounts)
          .set({ accountId: created.id, importFrom: nextDay(date) })
          .where(eq(bankAccounts.id, bankAccount.id));
        return created;
      });
      return reply
        .code(201)
        .send({ accountId: account.id, ...(await connectionView(bankAccount.connectionId)) });
    },
  );
}
