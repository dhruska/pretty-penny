import { bigint, date, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  'transactions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    date: date({ mode: 'string' }).notNull(),
    payee: text().notNull().default(''),
    memo: text().notNull().default(''),
    // Negative for outflows. Limits in routes/schemas.ts keep this within JavaScript's safe range.
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('transactions_account_order_idx').on(table.accountId, table.date)],
);
