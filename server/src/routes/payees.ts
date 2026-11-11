import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db, Executor } from '../db/client.js';
import { payees, transactionLines, transactions } from '../db/schema.js';
import { defaultCategory } from '../payee-defaults.js';

/** Finds a payee by name, ignoring case, or creates it. A blank name means no payee. */
export async function resolvePayee(tx: Executor, name: string | undefined) {
  const trimmed = name?.trim() ?? '';
  if (trimmed === '') return null;

  const [existing] = await tx
    .select({ id: payees.id })
    .from(payees)
    .where(sql`lower(${payees.name}) = lower(${trimmed})`);
  if (existing) return existing.id;

  const [created] = await tx.insert(payees).values({ name: trimmed }).returning({ id: payees.id });
  return created!.id;
}

export function registerPayeeRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/payees', async () => {
    const [payeeRows, history] = await Promise.all([
      db
        .select({ id: payees.id, name: payees.name })
        .from(payees)
        .orderBy(asc(sql`lower(${payees.name})`)),
      db
        .select({ payeeId: transactions.payeeId, categoryId: transactionLines.categoryId })
        .from(transactions)
        .innerJoin(transactionLines, eq(transactionLines.transactionId, transactions.id))
        .where(
          and(
            isNotNull(transactions.payeeId),
            isNotNull(transactionLines.categoryId),
            // Split transactions have no single category, so they don't count.
            sql`(select count(*) from transaction_lines l where l.transaction_id = ${transactions.id}) = 1`,
          ),
        )
        .orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id)),
    ]);

    const categoriesByPayee = new Map<number, number[]>();
    for (const { payeeId, categoryId } of history) {
      const list = categoriesByPayee.get(payeeId!) ?? [];
      list.push(categoryId!);
      categoriesByPayee.set(payeeId!, list);
    }

    return payeeRows.map((payee) => ({
      ...payee,
      defaultCategoryId: defaultCategory(categoriesByPayee.get(payee.id) ?? []),
    }));
  });
}
