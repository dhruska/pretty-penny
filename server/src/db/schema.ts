import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const READY_TO_ASSIGN_KEY = 'ready_to_assign';

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

export const categoryGroups = pgTable('category_groups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  hidden: boolean().notNull().default(false),
});

export const categories = pgTable('categories', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  // Only the seeded Ready to Assign category has no group.
  groupId: integer('group_id').references(() => categoryGroups.id, { onDelete: 'restrict' }),
  name: text().notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  hidden: boolean().notNull().default(false),
  systemKey: text('system_key').unique(),
});

export const transactionLines = pgTable(
  'transaction_lines',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    // Null means Uncategorized.
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    memo: text().notNull().default(''),
  },
  (table) => [
    index('transaction_lines_transaction_idx').on(table.transactionId),
    index('transaction_lines_category_idx').on(table.categoryId),
  ],
);

export const monthlyAssignments = pgTable(
  'monthly_assignments',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    month: text().notNull(),
    assignedCents: bigint('assigned_cents', { mode: 'number' }).notNull(),
  },
  (table) => [unique('monthly_assignments_category_month').on(table.categoryId, table.month)],
);
