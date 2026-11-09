export const STARTING_BALANCE_PAYEE = 'Starting Balance';

// $9,999,999,999.99. Sums of these stay well within JavaScript's safe integer range.
const MAX_AMOUNT_CENTS = 999_999_999_999;
const MAX_ID = 2_147_483_647;

export interface IdParams {
  id: number;
}

export const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1, maximum: MAX_ID } },
} as const;

export const accountName = {
  type: 'string',
  minLength: 1,
  maxLength: 100,
  pattern: '\\S',
} as const;
export const categoryName = accountName;
export const categoryId = { type: 'integer', minimum: 1, maximum: MAX_ID } as const;
export const month = { type: 'string', pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' } as const;
export const moveDirection = { type: 'string', enum: ['up', 'down'] } as const;
export const payee = { type: 'string', maxLength: 200 } as const;
export const memo = { type: 'string', maxLength: 500 } as const;
export const date = { type: 'string', format: 'date' } as const;
export const startingBalanceCents = {
  type: 'integer',
  minimum: -MAX_AMOUNT_CENTS,
  maximum: MAX_AMOUNT_CENTS,
} as const;
export const amountCents = { ...startingBalanceCents, not: { const: 0 } } as const;
