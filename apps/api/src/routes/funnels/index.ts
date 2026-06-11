import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const createFunnelSchema = z.object({
  name:      z.string().min(1),
  slug:      z.string().min(1).regex(/^[a-z0-9-]+$/),
  objective: z.enum(['audience', 'sell', 'custom', 'webinar']).optional(),
  domain:    z.string().optional(),
  currency:  z.string().length(3).optional(),
  settings:  z.record(z.unknown()).optional(),
});

const createPageSchema = z.object({
  type:  z.enum(['optin', 'sales', 'checkout', 'thanks', 'upsell', 'inactive']),
  slug:  z.string().min(1),
  title: z.string().min(1),
  blocks: z.array(z.unknown()).optional(),
  seo:    z.record(z.unknown()).optional(),
});

const abTestSchema = z.object({
  enabled:     z.boolean(),
  variantName: z.string().optional(),
  splitPct:    z.number().min(0).max(100).optional(),   // % de trafic vers la variante
  variantBlocks: z.array(z.unknown()).optional(),
});

const deadlineSchema = z.object({
  enabled:     z.boolean(),
  type:        z.enum(['fixed', 'evergreen']).optional(), // fixed = date fixe, evergreen = X jours depuis inscription
  endsAt:      z.string().datetime().optional(),           // si type = fixed
  durationDays: z.number().int().optional(),               // si type = evergreen
  redirectUrl:  z.string().optional(),                     // redirection après expiration
});

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

// Types de pages avec descriptions lisibles (comme Systeme.io)
const PAGE_TYPE_LABELS: Record<string, string> = {
  optin:    'Page de capture',
  sales:    'Page de vente',
  checkout: 'Bon de commande',
  thanks:   'Page de remerciement',
  upsell:   'Upsell / Order bump',
  inactive: 'Page inactive',
};

export default async function funnelRoutes(app: FastifyInstance) {
  // ── Liste des tunnels ─────────────────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as { status?: string; objective?: string; search?: string };
    return sql`
      SELECT f.*,
             COUNT(fp.id) as step_count,
             COALESCE(SUM(fp.leads_count), 0) as total_leads,
             COALESCE(SUM(fp.revenue), 0) as total_revenue
      FROM funnels f
      LEFT JOIN funnel_pages fp ON fp.funnel_id = f.id
      WHERE (${q.status ?? null} IS NULL OR f.status = ${q.status ?? null})
        AND (${q.objective ?? null} IS NULL OR f.objective = ${q.objective ?? null})
        AND (${q.search ?? null} IS NULL OR f.name ILIKE ${'%' + (q.search ?? '') + '%'})
      GROUP BY f.id
      ORDER BY f.created_at DESC
    `;
  });

  // ── Créer un tunnel ───────────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = createFunnelSchema.parse(request.body);
    const [funnel] = await sql`
      INSERT INTO funnels (name, slug, objective, domain, currency, settings)
      VALUES (
        ${body.name},
        ${body.slug},
        ${body.objective ?? 'custom'},
        ${body.domain ?? null},
        ${body.currency ?? 'XOF'},
        ${JSON.stringify(body.settings ?? {})}::jsonb
      )
      RETURNING *
    `;
    return reply.status(201).send(funnel);
  });

  // ── Détail d'un tunnel ────────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [funnel] = await sql`SELECT * FROM funnels WHERE id = ${id}`;
    if (!funnel) return reply.status(404).send({ error: 'not_found' });
    const pages = await sql`SELECT * FROM funnel_pages WHERE funnel_id = ${id} ORDER BY position`;
    return {
      ...funnel,
      steps: pages.map((p) => ({ ...p, typeLabel: PAGE_TYPE_LABELS[p.type] ?? p.type })),
    };
  });

  // ── Modifier un tunnel ────────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = createFunnelSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = {};
    if (body.name !== undefined)      cols.name      = body.name;
    if (body.slug !== undefined)      cols.slug      = body.slug;
    if (body.objective !== undefined) cols.objective = body.objective;
    if (body.domain !== undefined)    cols.domain    = body.domain;
    if (body.currency !== undefined)  cols.currency  = body.currency;
    if (body.settings !== undefined)  cols.settings  = JSON.stringify(body.settings);
    if (!Object.keys(cols).length) return reply.status(400).send({ error: 'no_fields' });
    const [updated] = await sql`UPDATE funnels SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer un tunnel ───────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM funnels WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── Étapes (pages) d'un tunnel ────────────────────────────
  app.get('/:id/pages', hooks, async (request) => {
    const { id } = request.params as { id: string };
    return sql`
      SELECT * FROM funnel_pages WHERE funnel_id = ${id} ORDER BY position
    `;
  });

  app.post('/:id/pages', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = createPageSchema.parse(request.body);
    const [maxPos] = await sql<{ max: number }[]>`
      SELECT COALESCE(MAX(position), -1) as max FROM funnel_pages WHERE funnel_id = ${id}
    `;
    const [page] = await sql`
      INSERT INTO funnel_pages (funnel_id, type, slug, title, blocks, seo, position)
      VALUES (
        ${id},
        ${body.type},
        ${body.slug},
        ${body.title},
        ${JSON.stringify(body.blocks ?? [])}::jsonb,
        ${JSON.stringify(body.seo ?? {})}::jsonb,
        ${(maxPos?.max ?? -1) + 1}
      )
      RETURNING *
    `;
    return reply.status(201).send({ ...page, typeLabel: PAGE_TYPE_LABELS[page.type] });
  });

  app.patch('/:id/pages/:pid', hooks, async (request, reply) => {
    const { pid } = request.params as { id: string; pid: string };
    const body = createPageSchema.partial().parse(request.body);
    const [page] = await sql`
      UPDATE funnel_pages
      SET ${sql(body as Record<string, unknown>)}, updated_at = now()
      WHERE id = ${pid}
      RETURNING *
    `;
    if (!page) return reply.status(404).send({ error: 'not_found' });
    return { ...page, typeLabel: PAGE_TYPE_LABELS[page.type] };
  });

  app.delete('/:id/pages/:pid', hooks, async (request, reply) => {
    await sql`DELETE FROM funnel_pages WHERE id = ${(request.params as { id: string; pid: string }).pid}`;
    return reply.status(204).send();
  });

  // Réordonner les étapes
  app.post('/:id/pages/reorder', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { order } = request.body as { order: string[] };
    for (let i = 0; i < order.length; i++) {
      await sql`UPDATE funnel_pages SET position = ${i} WHERE id = ${order[i]} AND funnel_id = ${id}`;
    }
    return { reordered: true };
  });

  // ── Test A/B ──────────────────────────────────────────────
  app.get('/:id/pages/:pid/ab-test', hooks, async (request, reply) => {
    const { pid } = request.params as { id: string; pid: string };
    const [page] = await sql<{ ab_test: unknown }[]>`
      SELECT ab_test FROM funnel_pages WHERE id = ${pid}
    `;
    if (!page) return reply.status(404).send({ error: 'not_found' });
    return { abTest: page.ab_test };
  });

  app.patch('/:id/pages/:pid/ab-test', hooks, async (request, reply) => {
    const { pid } = request.params as { id: string; pid: string };
    const body = abTestSchema.parse(request.body);
    const [page] = await sql`
      UPDATE funnel_pages SET ab_test = ${JSON.stringify(body)}::jsonb WHERE id = ${pid} RETURNING ab_test
    `;
    if (!page) return reply.status(404).send({ error: 'not_found' });
    return { abTest: page.ab_test };
  });

  // Statistiques A/B : vues + conversions par variante
  app.get('/:id/pages/:pid/ab-test/stats', hooks, async (request) => {
    const { pid } = request.params as { id: string; pid: string };
    const [control] = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM events
      WHERE type = 'page_view' AND payload->>'pageId' = ${pid} AND (payload->>'variant' IS NULL OR payload->>'variant' = 'control')
    `;
    const [variant] = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM events
      WHERE type = 'page_view' AND payload->>'pageId' = ${pid} AND payload->>'variant' = 'variant'
    `;
    const [controlConv] = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM events
      WHERE type = 'form_submit' AND payload->>'pageId' = ${pid} AND (payload->>'variant' IS NULL OR payload->>'variant' = 'control')
    `;
    const [variantConv] = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM events
      WHERE type = 'form_submit' AND payload->>'pageId' = ${pid} AND payload->>'variant' = 'variant'
    `;
    const cv = Number(control?.count ?? 0);
    const vv = Number(variant?.count ?? 0);
    const cc = Number(controlConv?.count ?? 0);
    const vc = Number(variantConv?.count ?? 0);
    return {
      control: { views: cv, conversions: cc, rate: cv > 0 ? ((cc / cv) * 100).toFixed(1) + '%' : '0%' },
      variant: { views: vv, conversions: vc, rate: vv > 0 ? ((vc / vv) * 100).toFixed(1) + '%' : '0%' },
    };
  });

  // ── Deadline / Compte à rebours ───────────────────────────
  app.get('/:id/pages/:pid/deadline', hooks, async (request, reply) => {
    const { pid } = request.params as { id: string; pid: string };
    const [page] = await sql<{ deadline: unknown }[]>`SELECT deadline FROM funnel_pages WHERE id = ${pid}`;
    if (!page) return reply.status(404).send({ error: 'not_found' });
    return { deadline: page.deadline };
  });

  app.patch('/:id/pages/:pid/deadline', hooks, async (request, reply) => {
    const { pid } = request.params as { id: string; pid: string };
    const body = deadlineSchema.parse(request.body);
    const [page] = await sql`
      UPDATE funnel_pages SET deadline = ${JSON.stringify(body)}::jsonb WHERE id = ${pid} RETURNING deadline
    `;
    if (!page) return reply.status(404).send({ error: 'not_found' });
    return { deadline: page.deadline };
  });

  // ── Leads d'un tunnel (contacts ayant soumis une étape) ──
  app.get('/:id/leads', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const q = request.query as { after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    return sql`
      SELECT DISTINCT c.id, c.email, c.first_name, c.last_name, c.phone,
             e.created_at as lead_at,
             e.payload->>'pageId' as step_id,
             fp.title as step_title,
             fp.type as step_type
      FROM events e
      JOIN contacts c ON c.id = e.contact_id
      JOIN funnel_pages fp ON fp.id::text = e.payload->>'pageId'
      WHERE fp.funnel_id = ${id}
        AND e.type = 'form_submit'
        AND (${q.after ?? null}::uuid IS NULL OR c.id > ${q.after ?? null}::uuid)
      ORDER BY e.created_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Stats par étape (vue depuis le tab "Statistiques") ───
  app.get('/:id/pages/:pid/stats', hooks, async (request) => {
    const { pid } = request.params as { id: string; pid: string };
    const q = request.query as { from?: string; to?: string };
    const now = new Date();
    const dateFrom = q.from ? new Date(q.from) : new Date(now.getTime() - 30 * 86_400_000);
    const dateTo   = q.to   ? new Date(q.to)   : now;

    const [views] = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM events
      WHERE type = 'page_view' AND payload->>'pageId' = ${pid}
        AND created_at >= ${dateFrom.toISOString()} AND created_at <= ${dateTo.toISOString()}
    `;
    const [submits] = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM events
      WHERE type = 'form_submit' AND payload->>'pageId' = ${pid}
        AND created_at >= ${dateFrom.toISOString()} AND created_at <= ${dateTo.toISOString()}
    `;
    const [revenue] = await sql<{ sum: string }[]>`
      SELECT COALESCE(SUM((payload->>'amount')::numeric), 0) as sum FROM events
      WHERE type = 'purchase' AND payload->>'pageId' = ${pid}
        AND created_at >= ${dateFrom.toISOString()} AND created_at <= ${dateTo.toISOString()}
    `;
    const series = await sql<{ day: string; views: string; submits: string }[]>`
      SELECT
        DATE(created_at) as day,
        COUNT(*) FILTER (WHERE type = 'page_view')   as views,
        COUNT(*) FILTER (WHERE type = 'form_submit') as submits
      FROM events
      WHERE payload->>'pageId' = ${pid}
        AND created_at >= ${dateFrom.toISOString()} AND created_at <= ${dateTo.toISOString()}
      GROUP BY DATE(created_at)
      ORDER BY day
    `;
    const v = Number(views?.count ?? 0);
    const s = Number(submits?.count ?? 0);
    return {
      period: { from: dateFrom, to: dateTo },
      views:       v,
      leads:       s,
      revenue:     Number(revenue?.sum ?? 0),
      conversionRate: v > 0 ? ((s / v) * 100).toFixed(1) + '%' : '0%',
      series: series.map((r) => ({ day: r.day, views: Number(r.views), submits: Number(r.submits) })),
    };
  });

  // ── Total du tunnel (revenus + leads globaux) ─────────────
  app.get('/:id/total', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const q = request.query as { from?: string; to?: string };
    const now = new Date();
    const dateFrom = q.from ? new Date(q.from) : new Date(now.getTime() - 30 * 86_400_000);
    const dateTo   = q.to   ? new Date(q.to)   : now;

    const [totals] = await sql`
      SELECT
        COUNT(DISTINCT e_leads.contact_id) as total_leads,
        COALESCE(SUM((e_rev.payload->>'amount')::numeric), 0) as total_revenue,
        COUNT(DISTINCT e_rev.contact_id) as total_buyers
      FROM funnel_pages fp
      LEFT JOIN events e_leads ON e_leads.payload->>'pageId' = fp.id::text
                               AND e_leads.type = 'form_submit'
                               AND e_leads.created_at BETWEEN ${dateFrom.toISOString()} AND ${dateTo.toISOString()}
      LEFT JOIN events e_rev   ON e_rev.payload->>'pageId' = fp.id::text
                               AND e_rev.type = 'purchase'
                               AND e_rev.created_at BETWEEN ${dateFrom.toISOString()} AND ${dateTo.toISOString()}
      WHERE fp.funnel_id = ${id}
    `;
    return { period: { from: dateFrom, to: dateTo }, ...totals };
  });

  // ── Publier un tunnel ─────────────────────────────────────
  app.post('/:id/publish', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [funnel] = await sql`UPDATE funnels SET status = 'published' WHERE id = ${id} RETURNING *`;
    if (!funnel) return reply.status(404).send({ error: 'not_found' });
    fetch(`${process.env.WEB_URL}/api/revalidate?funnelId=${id}&secret=${process.env.REVALIDATE_SECRET ?? ''}`).catch(() => null);
    return { funnel, published: true };
  });

  // Archiver un tunnel
  app.post('/:id/archive', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [funnel] = await sql`UPDATE funnels SET status = 'archived' WHERE id = ${id} RETURNING *`;
    if (!funnel) return reply.status(404).send({ error: 'not_found' });
    return funnel;
  });

  // ── Analytics globales du tunnel ──────────────────────────
  app.get('/:id/analytics', hooks, async (request) => {
    const { id } = request.params as { id: string };
    // Single query: pages + event counts via GROUP BY (replaces 1+2N queries)
    const rows = await sql<{
      page_id: string; title: string; slug: string; type: string;
      views: string; submissions: string;
    }[]>`
      SELECT
        fp.id                                                        AS page_id,
        fp.title,
        fp.slug,
        fp.type,
        COUNT(*) FILTER (WHERE e.type = 'page_view')                AS views,
        COUNT(*) FILTER (WHERE e.type = 'form_submit')              AS submissions
      FROM funnel_pages fp
      LEFT JOIN events e ON e.payload->>'pageId' = fp.id::text
        AND e.type IN ('page_view', 'form_submit')
      WHERE fp.funnel_id = ${id}
      GROUP BY fp.id, fp.title, fp.slug, fp.type
      ORDER BY fp.position
    `;
    return {
      funnelId: id,
      steps: rows.map((row) => {
        const v = Number(row.views ?? 0);
        const s = Number(row.submissions ?? 0);
        return {
          pageId:         row.page_id,
          title:          row.title,
          type:           row.type,
          typeLabel:      PAGE_TYPE_LABELS[row.type] ?? row.type,
          views:          v,
          submissions:    s,
          conversionRate: v > 0 ? ((s / v) * 100).toFixed(1) : '0',
        };
      }),
    };
  });
}
