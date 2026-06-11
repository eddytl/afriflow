import type { FastifyInstance } from 'fastify';
import { sql } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

function parseDateRange(from?: string, to?: string) {
  const now = new Date();
  const dateFrom = from ? new Date(from) : new Date(now.getTime() - 30 * 86_400_000);
  const dateTo = to ? new Date(to) : now;
  dateFrom.setHours(0, 0, 0, 0);
  dateTo.setHours(23, 59, 59, 999);
  return { dateFrom, dateTo };
}

export default async function analyticsRoutes(app: FastifyInstance) {
  // ── Tableau de bord principal (résultats mis en cache 60 s) ─
  app.get('/dashboard', hooks, async (request) => {
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const q = request.query as { from?: string; to?: string };
    const { dateFrom, dateTo } = parseDateRange(q.from, q.to);

    const cacheKey = `dashboard:${tenantId}:${dateFrom.toISOString()}:${dateTo.toISOString()}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const durationMs = dateTo.getTime() - dateFrom.getTime();
    const prevFrom   = new Date(dateFrom.getTime() - durationMs);
    const prevTo     = new Date(dateFrom.getTime() - 1);

    // Contacts : total + nouveaux + période précédente + série temporelle (4→1 query)
    const [contactsAgg] = await sql<{
      total: string; new_count: string; prev_count: string;
    }[]>`
      SELECT
        COUNT(*)                                                            AS total,
        COUNT(*) FILTER (WHERE created_at BETWEEN ${dateFrom.toISOString()} AND ${dateTo.toISOString()}) AS new_count,
        COUNT(*) FILTER (WHERE created_at BETWEEN ${prevFrom.toISOString()} AND ${prevTo.toISOString()}) AS prev_count
      FROM contacts
    `;
    const contactsSeries = await sql<{ day: string; count: string }[]>`
      SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM contacts
      WHERE created_at BETWEEN ${dateFrom.toISOString()} AND ${dateTo.toISOString()}
      GROUP BY DATE(created_at)
      ORDER BY day
    `;

    const newCount  = Number(contactsAgg?.new_count  ?? 0);
    const prevCount = Number(contactsAgg?.prev_count ?? 0);
    const growthPct = prevCount > 0
      ? (((newCount - prevCount) / prevCount) * 100).toFixed(1)
      : newCount > 0 ? '100.0' : '0.0';

    // Funnels + conversions + campagnes + automations (4 queries sur tables petites)
    const [funnelCounts] = await sql<{ total: string; published: string }[]>`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'published') AS published
      FROM funnels
    `;
    const [conversions] = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM events
      WHERE type IN ('purchase', 'form_submit')
        AND created_at BETWEEN ${dateFrom.toISOString()} AND ${dateTo.toISOString()}
    `;
    const [revenuePeriod] = await sql<{ period: string; total: string }[]>`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE created_at BETWEEN ${dateFrom.toISOString()} AND ${dateTo.toISOString()}), 0) AS period,
        COALESCE(SUM(amount), 0) AS total
      FROM public.payment_transactions
      WHERE tenant_id = ${tenantId} AND status = 'success'
    `;
    const campaignsStats = await sql<{ type: string; count: string; sent: string }[]>`
      SELECT type, COUNT(*) AS count, SUM((stats->>'sent')::int) AS sent
      FROM campaigns WHERE status = 'sent'
      GROUP BY type
    `;
    const [automAgg] = await sql<{ active: string; enrollments: string }[]>`
      SELECT
        (SELECT COUNT(*) FROM automations          WHERE status = 'active') AS active,
        (SELECT COUNT(*) FROM automation_enrollments WHERE status = 'active') AS enrollments
    `;

    // Visiteurs en direct (non mis en cache — fenêtre glissante de 15 min)
    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000);
    const [liveVisitors] = await sql<{ count: string }[]>`
      SELECT COUNT(DISTINCT contact_id) AS count FROM events
      WHERE type = 'page_view' AND created_at >= ${fifteenMinAgo.toISOString()}
    `;

    const result = {
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      contacts: {
        total:         Number(contactsAgg?.total    ?? 0),
        new:           newCount,
        growthPercent: Number(growthPct),
        series:        contactsSeries.map((r) => ({ day: r.day, count: Number(r.count) })),
      },
      funnels: {
        total:     Number(funnelCounts?.total     ?? 0),
        published: Number(funnelCounts?.published ?? 0),
      },
      conversions: Number(conversions?.count ?? 0),
      revenue: {
        period: Number(revenuePeriod?.period ?? 0),
        total:  Number(revenuePeriod?.total  ?? 0),
      },
      campaigns: campaignsStats.map((s) => ({
        type:  s.type,
        count: Number(s.count),
        sent:  Number(s.sent ?? 0),
      })),
      automations: {
        active:      Number(automAgg?.active      ?? 0),
        enrollments: Number(automAgg?.enrollments ?? 0),
      },
      live: { visitors: Number(liveVisitors?.count ?? 0) },
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', 60);
    return result;
  });

  // ── Flux d'événements bruts ───────────────────────────────
  app.get('/events', hooks, async (request) => {
    const q = request.query as { type?: string; contactId?: string; limit?: string; after?: string };
    const limit = Math.min(Number(q.limit ?? 50), 500);

    return sql`
      SELECT id, contact_id, type, payload, created_at FROM events
      WHERE (${q.type ?? null} IS NULL OR type = ${q.type ?? null})
        AND (${q.contactId ?? null}::uuid IS NULL OR contact_id = ${q.contactId ?? null}::uuid)
        AND (${q.after ?? null}::uuid IS NULL OR id > ${q.after ?? null}::uuid)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Métriques funnels : conversion par étape ─────────────
  app.get('/funnels/:id', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const q = request.query as { from?: string; to?: string };
    const { dateFrom, dateTo } = parseDateRange(q.from, q.to);

    const pages = await sql<{ id: string; title: string; position: number }[]>`
      SELECT id, title, position FROM funnel_pages WHERE funnel_id = ${id} ORDER BY position
    `;

    // Single query: pages + event counts via GROUP BY (replaces 1+2N queries)
    const stats = await sql<{
      page_id: string; title: string; position: string;
      views: string; submits: string;
    }[]>`
      SELECT
        fp.id                                                         AS page_id,
        fp.title,
        fp.position,
        COUNT(*) FILTER (WHERE e.type = 'page_view')                 AS views,
        COUNT(*) FILTER (WHERE e.type = 'form_submit')               AS submits
      FROM funnel_pages fp
      LEFT JOIN events e ON e.payload->>'pageId' = fp.id::text
        AND e.type IN ('page_view', 'form_submit')
        AND e.created_at BETWEEN ${dateFrom.toISOString()} AND ${dateTo.toISOString()}
      WHERE fp.funnel_id = ${id}
      GROUP BY fp.id, fp.title, fp.position
      ORDER BY fp.position
    `;

    return {
      funnelId: id,
      period: { from: dateFrom, to: dateTo },
      steps: stats.map((row) => {
        const v = Number(row.views ?? 0);
        const s = Number(row.submits ?? 0);
        return {
          pageId:   row.page_id,
          title:    row.title,
          position: Number(row.position),
          views:    v,
          submits:  s,
          rate:     v > 0 ? ((s / v) * 100).toFixed(1) + '%' : '0%',
        };
      }),
    };
  });
}
