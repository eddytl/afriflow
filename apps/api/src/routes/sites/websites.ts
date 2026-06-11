import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const websiteSchema = z.object({
  name:     z.string().min(1),
  domain:   z.string().optional(),
  urlPath:  z.string().optional(),
  language: z.enum(['fr', 'en', 'ar', 'sw', 'pt', 'ha']).optional(),
});

const pageSchema = z.object({
  title:  z.string().min(1),
  path:   z.string().min(1),
  blocks: z.array(z.unknown()).optional(),
  seo:    z.record(z.unknown()).optional(),
  isHome: z.boolean().optional(),
});

export default async function websiteRoutes(app: FastifyInstance) {
  // ── Liste des sites ──────────────────────────────────────
  app.get('/', hooks, async () => {
    return sql`
      SELECT w.*,
             COUNT(wp.id) as page_count
      FROM websites w
      LEFT JOIN website_pages wp ON wp.website_id = w.id
      GROUP BY w.id
      ORDER BY w.created_at DESC
    `;
  });

  // ── Créer un site ─────────────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = websiteSchema.parse(request.body);
    const [site] = await sql`
      INSERT INTO websites (name, domain, url_path, language)
      VALUES (
        ${body.name},
        ${body.domain ?? null},
        ${body.urlPath ?? null},
        ${body.language ?? 'fr'}
      )
      RETURNING *
    `;
    return reply.status(201).send(site);
  });

  // ── Détail d'un site avec ses pages ──────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [site] = await sql`SELECT * FROM websites WHERE id = ${id}`;
    if (!site) return reply.status(404).send({ error: 'not_found' });
    const pages = await sql`
      SELECT * FROM website_pages WHERE website_id = ${id} ORDER BY position, is_home DESC
    `;
    return { ...site, pages };
  });

  // ── Modifier un site ──────────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = websiteSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = {};
    if (body.name !== undefined)     cols.name      = body.name;
    if (body.domain !== undefined)   cols.domain    = body.domain;
    if (body.urlPath !== undefined)  cols.url_path  = body.urlPath;
    if (body.language !== undefined) cols.language  = body.language;
    if (!Object.keys(cols).length) return reply.status(400).send({ error: 'no_fields' });
    const [updated] = await sql`UPDATE websites SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer un site ─────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM websites WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── Toggle statut ─────────────────────────────────────────
  app.post('/:id/toggle', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [site] = await sql`
      UPDATE websites
      SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END
      WHERE id = ${id} RETURNING status
    `;
    if (!site) return reply.status(404).send({ error: 'not_found' });
    return { status: site.status };
  });

  // ── Pages d'un site ───────────────────────────────────────
  app.get('/:id/pages', hooks, async (request) => {
    const { id } = request.params as { id: string };
    return sql`
      SELECT * FROM website_pages WHERE website_id = ${id} ORDER BY is_home DESC, position
    `;
  });

  app.post('/:id/pages', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = pageSchema.parse(request.body);
    const [maxPos] = await sql<{ max: number }[]>`
      SELECT COALESCE(MAX(position), -1) as max FROM website_pages WHERE website_id = ${id}
    `;
    // Une seule page home autorisée
    if (body.isHome) {
      await sql`UPDATE website_pages SET is_home = false WHERE website_id = ${id}`;
    }
    const [page] = await sql`
      INSERT INTO website_pages (website_id, title, path, blocks, seo, is_home, position)
      VALUES (
        ${id},
        ${body.title},
        ${body.path},
        ${JSON.stringify(body.blocks ?? [])}::jsonb,
        ${JSON.stringify(body.seo ?? {})}::jsonb,
        ${body.isHome ?? false},
        ${(maxPos?.max ?? -1) + 1}
      )
      RETURNING *
    `;
    return reply.status(201).send(page);
  });

  app.get('/:id/pages/:pid', hooks, async (request, reply) => {
    const { pid } = request.params as { id: string; pid: string };
    const [page] = await sql`SELECT * FROM website_pages WHERE id = ${pid}`;
    if (!page) return reply.status(404).send({ error: 'not_found' });
    return page;
  });

  app.patch('/:id/pages/:pid', hooks, async (request, reply) => {
    const { pid } = request.params as { id: string; pid: string };
    const body = pageSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.title !== undefined)  cols.title   = body.title;
    if (body.path !== undefined)   cols.path    = body.path;
    if (body.blocks !== undefined) cols.blocks  = JSON.stringify(body.blocks);
    if (body.seo !== undefined)    cols.seo     = JSON.stringify(body.seo);
    if (body.isHome === true) {
      await sql`UPDATE website_pages SET is_home = false WHERE website_id = (SELECT website_id FROM website_pages WHERE id = ${pid})`;
      cols.is_home = true;
    }
    const [page] = await sql`UPDATE website_pages SET ${sql(cols)} WHERE id = ${pid} RETURNING *`;
    if (!page) return reply.status(404).send({ error: 'not_found' });
    return page;
  });

  app.delete('/:id/pages/:pid', hooks, async (request, reply) => {
    await sql`DELETE FROM website_pages WHERE id = ${(request.params as { id: string; pid: string }).pid}`;
    return reply.status(204).send();
  });

  // Réordonner les pages (drag & drop)
  app.post('/:id/pages/reorder', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { order } = request.body as { order: string[] }; // tableau d'UUIDs dans le nouvel ordre
    if (!Array.isArray(order)) return reply.status(400).send({ error: 'invalid_order' });
    for (let i = 0; i < order.length; i++) {
      await sql`UPDATE website_pages SET position = ${i} WHERE id = ${order[i]} AND website_id = ${id}`;
    }
    return { reordered: true };
  });

  // Publier toutes les pages d'un site
  app.post('/:id/publish', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    await sql`UPDATE website_pages SET status = 'published' WHERE website_id = ${id}`;
    const revalidateUrl = `${process.env.WEB_URL}/api/revalidate?websiteId=${id}&secret=${process.env.REVALIDATE_SECRET ?? ''}`;
    fetch(revalidateUrl).catch(() => null);
    return { published: true };
  });
}
