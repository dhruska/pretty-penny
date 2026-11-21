/**
 * The parts of YNAB's API (https://api.ynab.com) the import reads. Amounts are milliunits:
 * thousandths of the currency unit, so $1.00 is 1000. Dates are YYYY-MM-DD.
 */

export interface YnabPlanSummary {
  id: string;
  name: string;
  last_modified_on?: string | null;
}

export type YnabCleared = 'cleared' | 'uncleared' | 'reconciled';

export interface YnabAccount {
  id: string;
  name: string;
  type: string;
  on_budget: boolean;
  closed: boolean;
  balance: number;
  cleared_balance: number;
  last_reconciled_at?: string | null;
  deleted: boolean;
}

export interface YnabPayee {
  id: string;
  name: string;
  transfer_account_id?: string | null;
  deleted: boolean;
}

export interface YnabCategoryGroup {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
}

export interface YnabCategory {
  id: string;
  category_group_id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  budgeted: number;
  activity: number;
  balance: number;
}

export interface YnabMonth {
  /** The first day of the month, YYYY-MM-01. */
  month: string;
  /** Ready to Assign. */
  to_be_budgeted: number;
  deleted: boolean;
  categories: YnabCategory[];
}

export interface YnabTransaction {
  id: string;
  date: string;
  amount: number;
  memo?: string | null;
  cleared: YnabCleared;
  approved: boolean;
  flag_color?: string | null;
  /** The color's custom name, such as "Reimbursable". */
  flag_name?: string | null;
  account_id: string;
  payee_id?: string | null;
  category_id?: string | null;
  transfer_account_id?: string | null;
  transfer_transaction_id?: string | null;
  deleted: boolean;
}

export interface YnabSubtransaction {
  id: string;
  transaction_id: string;
  amount: number;
  memo?: string | null;
  payee_id?: string | null;
  category_id?: string | null;
  transfer_account_id?: string | null;
  transfer_transaction_id?: string | null;
  deleted: boolean;
}

export interface YnabScheduledTransaction {
  id: string;
  date_first: string;
  date_next: string;
  frequency: string;
  amount: number;
  memo?: string | null;
  flag_color?: string | null;
  flag_name?: string | null;
  account_id: string;
  payee_id?: string | null;
  category_id?: string | null;
  transfer_account_id?: string | null;
  deleted: boolean;
}

export interface YnabScheduledSubtransaction {
  id: string;
  scheduled_transaction_id: string;
  amount: number;
  memo?: string | null;
  payee_id?: string | null;
  category_id?: string | null;
  transfer_account_id?: string | null;
  deleted: boolean;
}

export interface YnabPlan {
  id: string;
  name: string;
  currency_format?: { iso_code: string; decimal_digits: number } | null;
  accounts: YnabAccount[];
  payees: YnabPayee[];
  category_groups: YnabCategoryGroup[];
  categories: YnabCategory[];
  months: YnabMonth[];
  transactions: YnabTransaction[];
  subtransactions: YnabSubtransaction[];
  scheduled_transactions: YnabScheduledTransaction[];
  scheduled_subtransactions: YnabScheduledSubtransaction[];
}
