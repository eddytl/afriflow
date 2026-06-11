import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const blogSchema = z.object({
  name:     z.string().min(1),
  domain:   z.string().optional(),
  urlPath:  z.string().min(1),
  language: z.enum(['fr', 'en', 'ar', 'sw', 'pt', 'ha']).optional(),
  template: z.string().optional(),
});

const categorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
});

const postSchema = z.object({
  title:         z.string().min(1),
  slug:          z.string().min(1).regex(/^[a-z0-9-]+$/),
  content:       z.string().optional(),
  excerpt:       z.string().optional(),
  featuredImage: z.string().url().optional(),
  categoryId:    z.string().uuid().optional(),
  seo:           z.record(z.unknown()).optional(),
  status:        z.enum(['draft', 'published']).optional(),
});

export default async function blogRoutes(app: FastifyInstance) {
  // ── Blogs ─────────────────────────────────────────────────
  app.get('/', hooks, async () => {
    return sql`
      SELECT b.*,
             COUNT(bp.id) as post_count
      FROM blogs b
      LEFT JOIN blog_posts bp ON bp.blog_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `;
  });

  app.post('/', hooks, async (request, reply) => {
    const body = blogSchema.parse(request.body);
    const [blog] = await sql`
      INSERT INTO blogs (name, domain, url_path, language, template)
      VALUES (
        ${body.name},
        ${body.domain ?? null},
        ${body.urlPath},
        ${body.language ?? 'fr'},
        ${body.template ?? 'default'}
      )
      RETURNING *
    `;
    return reply.status(201).send(blog);
  });

  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [blog] = await sql`SELECT * FROM blogs WHERE id = ${id}`;
    if (!blog) return reply.status(404).send({ error: 'not_found' });
    return blog;
  });

  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = blogSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = {};
    if (body.name !== undefined)     cols.name      = body.name;
    if (body.domain !== undefined)   cols.domain    = body.domain;
    if (body.urlPath !== undefined)  cols.url_path  = body.urlPath;
    if (body.language !== undefined) cols.language  = body.language;
    if (body.template !== undefined) cols.template  = body.template;
    if (!Object.keys(cols).length) return reply.status(400).send({ error: 'no_fields' });
    const [updated] = await sql`UPDATE blogs SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM blogs WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── Catégories ────────────────────────────────────────────
  app.get('/:id/categories', hooks, async (request) => {
    const { id } = request.params as { id: string };
    return sql`
      SELECT bc.*, COUNT(bp.id) as post_count
      FROM blog_categories bc
      LEFT JOIN blog_posts bp ON bp.category_id = bc.id
      WHERE bc.blog_id = ${id}
      GROUP BY bc.id
      ORDER BY bc.name
    `;
  });

  app.post('/:id/categories', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = categorySchema.parse(request.body);
    const [cat] = await sql`
      INSERT INTO blog_categories (blog_id, name, slug)
      VALUES (${id}, ${body.name}, ${body.slug})
      ON CONFLICT (blog_id, slug) DO NOTHING
      RETURNING *
    `;
    if (!cat) return reply.status(409).send({ error: 'slug_exists' });
    return reply.status(201).send(cat);
  });

  app.patch('/:id/categories/:cid', hooks, async (request, reply) => {
    const { cid } = request.params as { id: string; cid: string };
    const body = categorySchema.partial().parse(request.body);
    const cols: Record<string, unknown> = {};
    if (body.name !== undefined) cols.name = body.name;
    if (body.slug !== undefined) cols.slug = body.slug;
    const [updated] = await sql`UPDATE blog_categories SET ${sql(cols)} WHERE id = ${cid} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  app.delete('/:id/categories/:cid', hooks, async (request, reply) => {
    // Les posts de cette catégorie auront category_id = NULL (ON DELETE SET NULL)
    await sql`DELETE FROM blog_categories WHERE id = ${(request.params as { id: string; cid: string }).cid}`;
    return reply.status(204).send();
  });

  // ── Articles ──────────────────────────────────────────────
  app.get('/:id/posts', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const q = request.query as {
      status?: string;
      categoryId?: string;
      search?: string;
      after?: string;
      limit?: string;
    };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    return sql`
      SELECT bp.*,
             bc.name as category_name,
             bc.slug as category_slug
      FROM blog_posts bp
      LEFT JOIN blog_categories bc ON bc.id = bp.category_id
      WHERE bp.blog_id = ${id}
        AND (${q.status ?? null} IS NULL OR bp.status = ${q.status ?? null})
        AND (${q.categoryId ?? null}::uuid IS NULL OR bp.category_id = ${q.categoryId ?? null}::uuid)
        AND (${q.search ?? null} IS NULL OR bp.title ILIKE ${'%' + (q.search ?? '') + '%'})
        AND (${q.after ?? null}::uuid IS NULL OR bp.id > ${q.after ?? null}::uuid)
      ORDER BY bp.created_at DESC
      LIMIT ${limit}
    `;
  });

  app.post('/:id/posts', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = postSchema.parse(request.body);

    const publishedAt = body.status === 'published' ? new Date().toISOString() : null;

    const [post] = await sql`
      INSERT INTO blog_posts
        (blog_id, title, slug, content, excerpt, featured_image, category_id, seo, status, published_at)
      VALUES (
        ${id},
        ${body.title},
        ${body.slug},
        ${body.content ?? ''},
        ${body.excerpt ?? null},
        ${body.featuredImage ?? null},
        ${body.categoryId ?? null},
        ${JSON.stringify(body.seo ?? {})}::jsonb,
        ${body.status ?? 'draft'},
        ${publishedAt}
      )
      ON CONFLICT (blog_id, slug) DO NOTHING
      RETURNING *
    `;
    if (!post) return reply.status(409).send({ error: 'slug_exists' });
    return reply.status(201).send(post);
  });

  app.get('/:id/posts/:pid', hooks, async (request, reply) => {
    const { pid } = request.params as { id: string; pid: string };
    const [post] = await sql`
      SELECT bp.*, bc.name as category_name
      FROM blog_posts bp
      LEFT JOIN blog_categories bc ON bc.id = bp.category_id
      WHERE bp.id = ${pid}
    `;
    if (!post) return reply.status(404).send({ error: 'not_found' });
    return post;
  });

  app.patch('/:id/posts/:pid', hooks, async (request, reply) => {
    const { pid } = request.params as { id: string; pid: string };
    const body = postSchema.partial().parse(request.body);

    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.title !== undefined)         cols.title          = body.title;
    if (body.slug !== undefined)          cols.slug           = body.slug;
    if (body.content !== undefined)       cols.content        = body.content;
    if (body.excerpt !== undefined)       cols.excerpt        = body.excerpt;
    if (body.featuredImage !== undefined) cols.featured_image = body.featuredImage;
    if (body.categoryId !== undefined)    cols.category_id    = body.categoryId;
    if (body.seo !== undefined)           cols.seo            = JSON.stringify(body.seo);
    if (body.status !== undefined) {
      cols.status = body.status;
      if (body.status === 'published') {
        // On ne réinitialise pas published_at si déjà publié
        const [existing] = await sql<{ published_at: string | null }[]>`
          SELECT published_at FROM blog_posts WHERE id = ${pid}
        `;
        if (!existing?.published_at) cols.published_at = new Date();
      }
    }

    const [updated] = await sql`UPDATE blog_posts SET ${sql(cols)} WHERE id = ${pid} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  app.delete('/:id/posts/:pid', hooks, async (request, reply) => {
    await sql`DELETE FROM blog_posts WHERE id = ${(request.params as { id: string; pid: string }).pid}`;
    return reply.status(204).send();
  });

  // ── Stats du blog ─────────────────────────────────────────
  app.get('/:id/stats', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const [stats] = await sql`
      SELECT
        COUNT(*)                                                 as total,
        COUNT(*) FILTER (WHERE status = 'published')            as published,
        COUNT(*) FILTER (WHERE status = 'draft')                as drafts,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days') as last_30d
      FROM blog_posts
      WHERE blog_id = ${id}
    `;
    return stats;
  });

  // ── Mise en page des articles (ordonnancement) ─────────────
  app.get('/:id/layout', hooks, async (request) => {
    const { id } = request.params as { id: string };
    return sql`
      SELECT bp.id, bp.title, bp.slug, bp.status, bp.featured_image,
             bc.name as category_name, bp.published_at
      FROM blog_posts bp
      LEFT JOIN blog_categories bc ON bc.id = bp.category_id
      WHERE bp.blog_id = ${id} AND bp.status = 'published'
      ORDER BY bp.published_at DESC
    `;
  });
}
