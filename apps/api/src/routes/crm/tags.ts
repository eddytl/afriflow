import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql, withTenant } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const schema = z.object({
  name:  z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function tagsRoutes(app: FastifyInstance) {
  app.get('/', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    return withTenant(tenantId, (tx) => tx`
      SELECT
        t.id,
        t.name,
        t.color,
        t.created_at,
        COUNT(DISTINCT c.id)                                                          AS total_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.created_at::date = CURRENT_DATE)        AS today_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.created_at::date = CURRENT_DATE - 1)    AS yesterday_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.unsubscribed = true OR c.bounced = true) AS deleted_count,
        COALESCE(
          (SELECT ROUND(SUM(o.total)::numeric, 2)
           FROM orders o
           INNER JOIN contacts cc ON o.contact_id = cc.id
           WHERE t.name = ANY(cc.tags) AND o.status = 'paid'),
        0) AS total_sales
      FROM tags t
      LEFT JOIN contacts c ON t.name = ANY(c.tags)
      GROUP BY t.id
      ORDER BY t.name
    `);
  });

  app.post('/', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = schema.parse(request.body);
    const tag = await withTenant(tenantId, async (tx) => {
      const [t] = await tx`
        INSERT INTO tags (name, color)
        VALUES (${body.name}, ${body.color ?? '#6c63ff'})
        ON CONFLICT (name) DO NOTHING
        RETURNING *
      `;
      return t;
    });
    if (!tag) return reply.status(409).send({ error: 'tag_exists', message: 'Ce tag existe déjà' });
    return reply.status(201).send(tag);
  });

  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user as { tenantId: string };
    const body = schema.partial().parse(request.body);
    const updates: Record<string, unknown> = {};
    if (body.name)  updates.name  = body.name;
    if (body.color) updates.color = body.color;

    const tag = await withTenant(tenantId, (tx) =>
      tx`UPDATE tags SET ${tx(updates)} WHERE id = ${id} RETURNING *`.then(([t]) => t));
    if (!tag) return reply.status(404).send({ error: 'not_found' });
    return tag;
  });

  app.delete('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user as { tenantId: string };
    await withTenant(tenantId, async (tx) => {
      const [tag] = await tx<{ name: string }[]>`SELECT name FROM tags WHERE id = ${id}`;
      if (!tag) return;
      await tx`UPDATE contacts SET tags = array_remove(tags, ${tag.name}) WHERE ${tag.name} = ANY(tags)`;
      await tx`DELETE FROM tags WHERE id = ${id}`;
    });
    return reply.status(204).send();
  });

  app.get('/:id/contacts', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user as { tenantId: string };
    return withTenant(tenantId, async (tx) => {
      const [tag] = await tx<{ name: string }[]>`SELECT name FROM tags WHERE id = ${id}`;
      if (!tag) return [];
      return tx`SELECT * FROM contacts WHERE ${tag.name} = ANY(tags) ORDER BY created_at DESC`;
    });
  });
}
