import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import {
  categories,
  categoryGroups,
  monthlyAssignments,
  READY_TO_ASSIGN_KEY,
  transactionLines,
} from '../db/schema.js';
import { categoryId, categoryName, idParams, moveDirection, type IdParams } from './schemas.js';

type Direction = 'up' | 'down';

interface MoveBody {
  direction: Direction;
}

interface GroupPatchBody {
  name?: string;
  hidden?: boolean;
}

interface CategoryCreateBody {
  groupId: number;
  name: string;
}

interface CategoryPatchBody extends GroupPatchBody {
  groupId?: number;
}

const moveSchema = {
  params: idParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['direction'],
    properties: { direction: moveDirection },
  },
};

/** Returns the ids in their new order, or null if the item can't move that way. */
function reorder(ids: number[], id: number, direction: Direction): number[] | null {
  const from = ids.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= ids.length) return null;

  const result = [...ids];
  result[from] = ids[to]!;
  result[to] = id;
  return result;
}

const isUserCategory = (id: number) => and(eq(categories.id, id), isNull(categories.systemKey));

export async function loadCategories(db: Db) {
  const [groupRows, categoryRows] = await Promise.all([
    db.select().from(categoryGroups).orderBy(asc(categoryGroups.sortOrder), asc(categoryGroups.id)),
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id)),
  ]);

  const readyToAssign = categoryRows.find((row) => row.systemKey === READY_TO_ASSIGN_KEY);
  if (!readyToAssign) throw new Error('The Ready to Assign category is missing');

  return {
    readyToAssignId: readyToAssign.id,
    groups: groupRows.map((group) => ({
      id: group.id,
      name: group.name,
      hidden: group.hidden,
      categories: categoryRows
        .filter((category) => category.groupId === group.id)
        .map(({ id, name, hidden }) => ({ id, name, hidden })),
    })),
  };
}

export function registerCategoryRoutes(app: FastifyInstance, db: Db) {
  async function nextCategorySortOrder(groupId: number) {
    const [row] = await db
      .select({ next: sql<number>`coalesce(max(${categories.sortOrder}), -1) + 1`.mapWith(Number) })
      .from(categories)
      .where(eq(categories.groupId, groupId));
    return row!.next;
  }

  async function groupExists(id: number) {
    const [group] = await db
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(eq(categoryGroups.id, id));
    return group !== undefined;
  }

  app.get('/api/categories', () => loadCategories(db));

  app.post<{ Body: { name: string } }>(
    '/api/category-groups',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: categoryName },
        },
      },
    },
    async (request, reply) => {
      const [row] = await db
        .select({
          next: sql<number>`coalesce(max(${categoryGroups.sortOrder}), -1) + 1`.mapWith(Number),
        })
        .from(categoryGroups);
      const [created] = await db
        .insert(categoryGroups)
        .values({ name: request.body.name.trim(), sortOrder: row!.next })
        .returning();
      return reply.code(201).send(created);
    },
  );

  app.patch<{ Params: IdParams; Body: GroupPatchBody }>(
    '/api/category-groups/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { name: categoryName, hidden: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const { name, hidden } = request.body;
      if (name === undefined && hidden === undefined) {
        return reply.code(400).send({ message: 'Nothing to update' });
      }

      const [updated] = await db
        .update(categoryGroups)
        .set({ name: name?.trim(), hidden })
        .where(eq(categoryGroups.id, request.params.id))
        .returning();
      if (!updated) return reply.code(404).send({ message: 'Category group not found' });
      return updated;
    },
  );

  app.post<{ Params: IdParams; Body: MoveBody }>(
    '/api/category-groups/:id/move',
    { schema: moveSchema },
    async (request, reply) => {
      const rows = await db
        .select({ id: categoryGroups.id })
        .from(categoryGroups)
        .orderBy(asc(categoryGroups.sortOrder), asc(categoryGroups.id));
      const ids = rows.map((row) => row.id);
      if (!ids.includes(request.params.id)) {
        return reply.code(404).send({ message: 'Category group not found' });
      }

      const order = reorder(ids, request.params.id, request.body.direction);
      if (order) {
        await db.transaction(async (tx) => {
          for (const [sortOrder, id] of order.entries()) {
            await tx.update(categoryGroups).set({ sortOrder }).where(eq(categoryGroups.id, id));
          }
        });
      }
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: IdParams }>(
    '/api/category-groups/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const { id } = request.params;

      const [member] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.groupId, id))
        .limit(1);
      if (member) {
        return reply
          .code(409)
          .send({ message: 'Move or delete this group’s categories before deleting it.' });
      }

      const deleted = await db
        .delete(categoryGroups)
        .where(eq(categoryGroups.id, id))
        .returning({ id: categoryGroups.id });
      if (deleted.length === 0)
        return reply.code(404).send({ message: 'Category group not found' });
      return reply.code(204).send();
    },
  );

  app.post<{ Body: CategoryCreateBody }>(
    '/api/categories',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['groupId', 'name'],
          properties: { groupId: categoryId, name: categoryName },
        },
      },
    },
    async (request, reply) => {
      const { groupId, name } = request.body;
      if (!(await groupExists(groupId))) {
        return reply.code(400).send({ message: 'Category group not found' });
      }

      const [created] = await db
        .insert(categories)
        .values({ groupId, name: name.trim(), sortOrder: await nextCategorySortOrder(groupId) })
        .returning({ id: categories.id, name: categories.name, hidden: categories.hidden });
      return reply.code(201).send(created);
    },
  );

  app.patch<{ Params: IdParams; Body: CategoryPatchBody }>(
    '/api/categories/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { name: categoryName, hidden: { type: 'boolean' }, groupId: categoryId },
        },
      },
    },
    async (request, reply) => {
      const { name, hidden, groupId } = request.body;
      if (name === undefined && hidden === undefined && groupId === undefined) {
        return reply.code(400).send({ message: 'Nothing to update' });
      }
      if (groupId !== undefined && !(await groupExists(groupId))) {
        return reply.code(400).send({ message: 'Category group not found' });
      }

      const [updated] = await db
        .update(categories)
        .set({
          name: name?.trim(),
          hidden,
          groupId,
          sortOrder: groupId === undefined ? undefined : await nextCategorySortOrder(groupId),
        })
        .where(isUserCategory(request.params.id))
        .returning({
          id: categories.id,
          name: categories.name,
          hidden: categories.hidden,
          groupId: categories.groupId,
        });
      if (!updated) return reply.code(404).send({ message: 'Category not found' });
      return updated;
    },
  );

  app.post<{ Params: IdParams; Body: MoveBody }>(
    '/api/categories/:id/move',
    { schema: moveSchema },
    async (request, reply) => {
      const { id } = request.params;
      const [category] = await db
        .select({ groupId: categories.groupId })
        .from(categories)
        .where(isUserCategory(id));
      if (!category) return reply.code(404).send({ message: 'Category not found' });

      const siblings = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.groupId, category.groupId!))
        .orderBy(asc(categories.sortOrder), asc(categories.id));

      const order = reorder(
        siblings.map((row) => row.id),
        id,
        request.body.direction,
      );
      if (order) {
        await db.transaction(async (tx) => {
          for (const [sortOrder, siblingId] of order.entries()) {
            await tx.update(categories).set({ sortOrder }).where(eq(categories.id, siblingId));
          }
        });
      }
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: IdParams }>(
    '/api/categories/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const { id } = request.params;

      const [line] = await db
        .select({ id: transactionLines.id })
        .from(transactionLines)
        .where(eq(transactionLines.categoryId, id))
        .limit(1);
      const [assignment] = await db
        .select({ id: monthlyAssignments.id })
        .from(monthlyAssignments)
        .where(eq(monthlyAssignments.categoryId, id))
        .limit(1);
      if (line || assignment) {
        return reply.code(409).send({
          message: 'This category has been used, so it can’t be deleted. Hide it instead.',
        });
      }

      const deleted = await db
        .delete(categories)
        .where(isUserCategory(id))
        .returning({ id: categories.id });
      if (deleted.length === 0) return reply.code(404).send({ message: 'Category not found' });
      return reply.code(204).send();
    },
  );
}
