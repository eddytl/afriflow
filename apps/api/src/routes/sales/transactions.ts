import type { FastifyInstance } from 'fastify';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const TRANSACTION_TYPES = [
  { value: 'payment',              label: 'Paiement' },
  { value: 'refund',               label: 'Remboursement' },
  { value: 'subscription_renewal', label: 'Renouvellement abonnement' },
  { value: 'chargeback',           label: 'Litige / Chargeback' },
] as const;

const CUSTOMER_TYPES = [
  { value: 'new',       label: 'Nouveau client' },
  { value: 'returning', label: 'Client existant' },
] as const;

export default async function transactionsRoutes(app: FastifyInstance) {

  // ── Méta ──────────────────────────────────────────────────
  app.get('/types',          hooks, async () => TRANSACTION_TYPES);
  app.get('/customer-types', hooks, async () => CUSTOMER_TYPES);

  // ── Liste avec filtres avancés ────────────────────────────
  app.get('/', hooks, async (request) => {
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const q = request.query as {
      email?:           string;
      country?:         string;
      customerType?:    string;
      providerRef?:     string;
      planId?:          string;
      type?:            string;
      status?:          string;
      provider?:        string;
      dateFrom?:        string;
      dateTo?:          string;
      after?:           string;
      limit?:           string;
    };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    // La table public.payment_transactions est dans le schéma public
    // On fait un SET search_path minimal pour que la jointure contacts fonctionne
    const rows = await sql`
      SELECT
        pt.*,
        c.email        as contact_email,
        c.first_name,
        c.last_name,
        c.phone,
        c.country      as contact_country
      FROM public.payment_transactions pt
      LEFT JOIN contacts c ON c.id = pt.contact_id
      WHERE pt.tenant_id = ${tenantId}
        AND (${q.status       ?? null} IS NULL OR pt.status        = ${q.status       ?? null})
        AND (${q.type         ?? null} IS NULL OR pt.type          = ${q.type         ?? null})
        AND (${q.provider     ?? null} IS NULL OR pt.provider      = ${q.provider     ?? null})
        AND (${q.country      ?? null} IS NULL OR pt.country       = ${q.country      ?? null})
        AND (${q.customerType ?? null} IS NULL OR pt.customer_type = ${q.customerType ?? null})
        AND (${q.providerRef  ?? null} IS NULL OR pt.provider_ref  ILIKE ${'%' + (q.providerRef ?? '') + '%'})
        AND (${q.email        ?? null} IS NULL OR c.email          ILIKE ${'%' + (q.email       ?? '') + '%'})
        AND (${q.dateFrom     ?? null} IS NULL OR pt.created_at   >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo       ?? null} IS NULL OR pt.created_at   <= ${q.dateTo   ?? null}::timestamptz)
        AND (${q.after        ?? null}::uuid IS NULL OR pt.id > ${q.after ?? null}::uuid)
      ORDER BY pt.created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      ...r,
      typeLabel:         TRANSACTION_TYPES.find((t) => t.value === r.type)?.label ?? r.type,
      customerTypeLabel: CUSTOMER_TYPES.find((t) => t.value === r.customer_type)?.label ?? r.customer_type,
    }));
  });

  // ── Détail d'une transaction ──────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const [tx] = await sql`
      SELECT pt.*, c.email, c.first_name, c.last_name, c.phone, c.country as contact_country
      FROM public.payment_transactions pt
      LEFT JOIN contacts c ON c.id = pt.contact_id
      WHERE pt.id = ${id} AND pt.tenant_id = ${tenantId}
    `;
    if (!tx) return reply.status(404).send({ error: 'not_found' });

    // Trouver la commande liée
    const [order] = await sql`SELECT id, order_number, status FROM orders WHERE payment_transaction_id = ${id}`;
    return { ...tx, order: order ?? null };
  });

  // ── Stats globales ────────────────────────────────────────
  app.get('/stats/overview', hooks, async (request) => {
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const q = request.query as { dateFrom?: string; dateTo?: string; currency?: string };

    const [stats] = await sql<{
      total: string; total_amount: string;
      payments: string; refunds: string; refund_amount: string;
      success: string; failed: string;
    }[]>`
      SELECT
        COUNT(*)                                                  as total,
        COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0) as total_amount,
        COUNT(*) FILTER (WHERE type = 'payment')                  as payments,
        COUNT(*) FILTER (WHERE type = 'refund')                   as refunds,
        COALESCE(SUM(amount) FILTER (WHERE type = 'refund'), 0)   as refund_amount,
        COUNT(*) FILTER (WHERE status = 'success')                as success,
        COUNT(*) FILTER (WHERE status = 'failed')                 as failed
      FROM public.payment_transactions
      WHERE tenant_id = ${tenantId}
        AND (${q.dateFrom ?? null} IS NULL OR created_at >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo   ?? null} IS NULL OR created_at <= ${q.dateTo   ?? null}::timestamptz)
    `;

    const byProvider = await sql<{ provider: string; count: string; total: string }[]>`
      SELECT provider, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
      FROM public.payment_transactions
      WHERE tenant_id = ${tenantId} AND status = 'success'
        AND (${q.dateFrom ?? null} IS NULL OR created_at >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo   ?? null} IS NULL OR created_at <= ${q.dateTo   ?? null}::timestamptz)
      GROUP BY provider
    `;

    const daily = await sql<{ day: string; amount: string; count: string }[]>`
      SELECT DATE(created_at) as day, SUM(amount) as amount, COUNT(*) as count
      FROM public.payment_transactions
      WHERE tenant_id = ${tenantId} AND status = 'success' AND type = 'payment'
        AND created_at >= now() - interval '30 days'
      GROUP BY DATE(created_at) ORDER BY day
    `;

    return {
      total:        Number(stats?.total ?? 0),
      totalAmount:  Number(stats?.total_amount ?? 0),
      payments:     Number(stats?.payments ?? 0),
      refunds:      Number(stats?.refunds ?? 0),
      refundAmount: Number(stats?.refund_amount ?? 0),
      success:      Number(stats?.success ?? 0),
      failed:       Number(stats?.failed ?? 0),
      byProvider:   byProvider.map((p) => ({ provider: p.provider, count: Number(p.count), total: Number(p.total) })),
      daily:        daily.map((d) => ({ day: d.day, amount: Number(d.amount), count: Number(d.count) })),
    };
  });

  // ── Export CSV ────────────────────────────────────────────
  app.get('/export', hooks, async (request, reply) => {
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const q = request.query as { dateFrom?: string; dateTo?: string; type?: string; status?: string };
    const rows = await sql`
      SELECT pt.id, pt.amount, pt.currency, pt.provider, pt.provider_ref,
             pt.type, pt.status, pt.country, pt.customer_type, pt.created_at,
             c.email, c.first_name, c.last_name
      FROM public.payment_transactions pt
      LEFT JOIN contacts c ON c.id = pt.contact_id
      WHERE pt.tenant_id = ${tenantId}
        AND (${q.type     ?? null} IS NULL OR pt.type      = ${q.type     ?? null})
        AND (${q.status   ?? null} IS NULL OR pt.status    = ${q.status   ?? null})
        AND (${q.dateFrom ?? null} IS NULL OR pt.created_at >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo   ?? null} IS NULL OR pt.created_at <= ${q.dateTo   ?? null}::timestamptz)
      ORDER BY pt.created_at DESC
    `;

    const header = 'ID,Email,Prénom,Nom,Montant,Devise,Prestataire,Référence,Type,Statut,Pays,Date\n';
    const csv = rows.map((r) =>
      [r.id, r.email ?? '', r.first_name ?? '', r.last_name ?? '',
       r.amount, r.currency, r.provider, r.provider_ref ?? '',
       r.type, r.status, r.country ?? '', new Date(r.created_at).toISOString()].join(','),
    ).join('\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="transactions.csv"');
    return reply.send(header + csv);
  });
}
