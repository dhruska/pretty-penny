import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { flagNames } from '../db/schema.js';
import { FLAG_COLORS, type FlagColor } from '../flags.js';

const MAX_NAME_LENGTH = 50;

export function registerFlagRoutes(app: FastifyInstance, db: Db) {
  /** Every flag color, in YNAB's order, with its custom name or null. */
  async function listFlags() {
    const rows = await db.select().from(flagNames);
    const names = new Map(rows.map((row) => [row.color, row.name]));
    return FLAG_COLORS.map((color) => ({ color, name: names.get(color) ?? null }));
  }

  app.get('/api/flags', listFlags);

  // A blank name clears it, so the flag goes back to its color.
  app.put<{ Params: { color: FlagColor }; Body: { name: string } }>(
    '/api/flags/:color',
    {
      schema: {
        params: {
          type: 'object',
          required: ['color'],
          properties: { color: { type: 'string', enum: FLAG_COLORS } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: { type: 'string', maxLength: MAX_NAME_LENGTH } },
        },
      },
    },
    async (request) => {
      const { color } = request.params;
      const name = request.body.name.trim();
      if (name === '') {
        await db.delete(flagNames).where(eq(flagNames.color, color));
      } else {
        await db
          .insert(flagNames)
          .values({ color, name })
          .onConflictDoUpdate({ target: flagNames.color, set: { name } });
      }
      return listFlags();
    },
  );
}
