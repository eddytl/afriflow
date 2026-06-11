import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const commissionStructureSchema = z.object({
  offerName:         z.string().min(1),
  offerId:           z.string().uuid().optional(),
  offerType:         z.enum(['funnel_page', 'product']).default('funnel_page'),
  paymentDelayDays:  z.number().int().min(0).default(30),
  commissionRate:    z.number().min(0).max(100).default(0),
});

export default async function affiliateProgramRoutes(app: FastifyInstance) {

  // ── Tableau de bord du programme d'affiliation ────────────
  app.get('/dashboard', hooks, async (request) => {
    const q = request.query as { dateFrom?: string; dateTo?: string; currency?: string };

    // Ventes générées par les affiliés
    const [salesStats] = await sql<{ total_sales: string; total_commissions: string }[]>`
      SELECT
        COALESCE(SUM(o.total), 0)                                as total_sales,
        COALESCE(SUM(o.total * acs.commission_rate / 100), 0)    as total_commissions
      FROM orders o
      JOIN contacts aff ON aff.id = o.metadata->>'affiliateId'
      LEFT JOIN affiliate_commission_structures acs
        ON acs.offer_id = o.source_id AND acs.status = 'active'
      WHERE o.status = 'paid'
        AND (${q.dateFrom ?? null} IS NULL OR o.created_at >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo   ?? null} IS NULL OR o.created_at <= ${q.dateTo   ?? null}::timestamptz)
        AND (${q.currency ?? null} IS NULL OR o.currency   = ${q.currency  ?? null})
    `;

    // Nombre de contacts référés
    const [contactStats] = await sql<{ referred_contacts: string }[]>`
      SELECT COUNT(DISTINCT id) as referred_contacts
      FROM contacts
      WHERE metadata->>'referredBy' IS NOT NULL
        AND (${q.dateFrom ?? null} IS NULL OR created_at >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo   ?? null} IS NULL OR created_at <= ${q.dateTo   ?? null}::timestamptz)
    `;

    return {
      sales:             Number(salesStats?.total_sales ?? 0),
      commissions:       Number(salesStats?.total_commissions ?? 0),
      referredContacts:  Number(contactStats?.referred_contacts ?? 0),
    };
  });

  // ── Liste des affiliés avec filtres ───────────────────────
  app.get('/affiliates', hooks, async (request) => {
    const q = request.query as {
      email?:       string;
      affiliateId?: string;
      after?:       string;
      limit?:       string;
    };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    return sql`
      SELECT
        c.id, c.email, c.first_name, c.last_name,
        c.metadata->>'affiliateId'   as affiliate_handle,
        c.metadata->>'affiliateCode' as affiliate_code,
        c.metadata->>'commissionRate' as custom_commission_rate,
        COUNT(DISTINCT ref.id)        as referred_contacts,
        COALESCE(SUM(o.total) FILTER (WHERE o.status = 'paid'), 0) as total_sales,
        c.created_at
      FROM contacts c
      LEFT JOIN contacts ref ON ref.metadata->>'referredBy' = c.id::text
      LEFT JOIN orders o ON o.metadata->>'affiliateId' = c.id::text
      WHERE c.metadata->>'affiliateId' IS NOT NULL
        AND (${q.email       ?? null} IS NULL OR c.email           ILIKE ${'%' + (q.email       ?? '') + '%'})
        AND (${q.affiliateId ?? null} IS NULL OR c.metadata->>'affiliateId' ILIKE ${'%' + (q.affiliateId ?? '') + '%'})
        AND (${q.after       ?? null}::uuid IS NULL OR c.id > ${q.after ?? null}::uuid)
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Détail d'un affilié ───────────────────────────────────
  app.get('/affiliates/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [affiliate] = await sql`SELECT * FROM contacts WHERE id = ${id}`;
    if (!affiliate) return reply.status(404).send({ error: 'not_found' });

    const recentOrders = await sql`
      SELECT id, order_number, total, currency, status, created_at
      FROM orders WHERE metadata->>'affiliateId' = ${id} ORDER BY created_at DESC LIMIT 10
    `;
    const recentInvoices = await sql`
      SELECT id, amount, currency, status, period_start, period_end, paid_at
      FROM affiliate_invoices WHERE affiliate_id = ${id} ORDER BY created_at DESC LIMIT 10
    `;
    const [commStats] = await sql<{ total_commissions: string; paid_commissions: string }[]>`
      SELECT
        COALESCE(SUM(amount), 0)                              as total_commissions,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as paid_commissions
      FROM affiliate_invoices WHERE affiliate_id = ${id}
    `;

    return {
      ...affiliate,
      recentOrders,
      recentInvoices,
      totalCommissions: Number(commStats?.total_commissions ?? 0),
      paidCommissions:  Number(commStats?.paid_commissions  ?? 0),
    };
  });

  // ── Structures de commission ──────────────────────────────

  app.get('/commission-structures', hooks, async () => {
    return sql`SELECT * FROM affiliate_commission_structures ORDER BY created_at DESC`;
  });

  app.post('/commission-structures', hooks, async (request, reply) => {
    const body = commissionStructureSchema.parse(request.body);
    const [structure] = await sql`
      INSERT INTO affiliate_commission_structures (
        offer_name, offer_id, offer_type, payment_delay_days, commission_rate
      ) VALUES (
        ${body.offerName}, ${body.offerId ?? null}, ${body.offerType},
        ${body.paymentDelayDays}, ${body.commissionRate}
      )
      RETURNING *
    `;
    return reply.status(201).send(structure);
  });

  app.patch('/commission-structures/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = commissionStructureSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.offerName        !== undefined) cols.offer_name          = body.offerName;
    if (body.offerId          !== undefined) cols.offer_id            = body.offerId;
    if (body.offerType        !== undefined) cols.offer_type          = body.offerType;
    if (body.paymentDelayDays !== undefined) cols.payment_delay_days  = body.paymentDelayDays;
    if (body.commissionRate   !== undefined) cols.commission_rate     = body.commissionRate;
    const [updated] = await sql`
      UPDATE affiliate_commission_structures SET ${sql(cols)} WHERE id = ${id} RETURNING *
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  app.delete('/commission-structures/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM affiliate_commission_structures WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── Paramètres du programme ───────────────────────────────
  app.get('/settings', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const [tenant] = await sql`SELECT settings FROM public.tenants WHERE id = ${tenantId}`;
    return (tenant?.settings?.affiliate ?? {
      enabled:             true,
      defaultCommission:   0,
      cookieDurationDays:  30,
      autoApprove:         false,
      paymentDelayDays:    30,
      minimumPayout:       0,
    });
  });

  app.patch('/settings', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const settings = request.body as Record<string, unknown>;
    await sql`
      UPDATE public.tenants
      SET settings = jsonb_set(COALESCE(settings, '{}'), '{affiliate}', ${JSON.stringify(settings)}::jsonb)
      WHERE id = ${tenantId}
    `;
    return settings;
  });

  // ── Générer un lien d'affiliation pour un affilié ─────────
  app.post('/affiliates/:id/generate-link', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { targetUrl } = request.body as { targetUrl?: string };

    const [affiliate] = await sql`
      SELECT id, metadata->>'affiliateCode' as code FROM contacts WHERE id = ${id}
    `;
    if (!affiliate) return reply.status(404).send({ error: 'not_found' });

    // Générer un code si absent
    if (!affiliate.code) {
      const newCode = id.replace(/-/g, '').slice(0, 8).toUpperCase();
      await sql`
        UPDATE contacts SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{affiliateCode}', ${JSON.stringify(newCode)}::jsonb)
        WHERE id = ${id}
      `;
      affiliate.code = newCode;
    }

    const base = targetUrl ?? (process.env.WEB_URL ?? 'https://app.afriflow.app');
    const url  = `${base}?ref=${affiliate.code}`;
    return { affiliateCode: affiliate.code, url };
  });
}
