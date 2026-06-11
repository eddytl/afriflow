import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const INVOICE_STATUSES = [
  { value: 'pending',    label: 'En attente' },
  { value: 'processing', label: 'En cours de traitement' },
  { value: 'paid',       label: 'Payée' },
  { value: 'rejected',   label: 'Rejetée' },
] as const;

const PAYMENT_METHODS = [
  { value: 'bank_transfer',  label: 'Virement bancaire' },
  { value: 'mobile_money',   label: 'Mobile Money' },
  { value: 'paypal',         label: 'PayPal' },
  { value: 'crypto',         label: 'Crypto-monnaie' },
] as const;

const invoiceSchema = z.object({
  affiliateId:    z.string().uuid(),
  periodStart:    z.string().datetime(),
  periodEnd:      z.string().datetime(),
  amount:         z.number().min(0),
  currency:       z.string().length(3).default('XAF'),
  paymentMethod:  z.string().optional(),
  notes:          z.string().optional(),
});

export default async function affiliateInvoicesRoutes(app: FastifyInstance) {

  // ── Méta ──────────────────────────────────────────────────
  app.get('/statuses',        hooks, async () => INVOICE_STATUSES);
  app.get('/payment-methods', hooks, async () => PAYMENT_METHODS);

  // ── Liste avec filtres ────────────────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as {
      status?:        string;
      currency?:      string;
      paymentMethod?: string;
      email?:         string;
      dateFrom?:      string;
      dateTo?:        string;
      after?:         string;
      limit?:         string;
    };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    const rows = await sql`
      SELECT ai.*,
             c.email, c.first_name, c.last_name,
             c.metadata->>'affiliateId' as affiliate_handle
      FROM affiliate_invoices ai
      LEFT JOIN contacts c ON c.id = ai.affiliate_id
      WHERE (${q.status        ?? null} IS NULL OR ai.status         = ${q.status        ?? null})
        AND (${q.currency      ?? null} IS NULL OR ai.currency        = ${q.currency      ?? null})
        AND (${q.paymentMethod ?? null} IS NULL OR ai.payment_method  = ${q.paymentMethod ?? null})
        AND (${q.email         ?? null} IS NULL OR c.email            ILIKE ${'%' + (q.email ?? '') + '%'})
        AND (${q.dateFrom      ?? null} IS NULL OR ai.created_at     >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo        ?? null} IS NULL OR ai.created_at     <= ${q.dateTo   ?? null}::timestamptz)
        AND (${q.after         ?? null}::uuid IS NULL OR ai.id > ${q.after ?? null}::uuid)
      ORDER BY ai.created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((i) => ({
      ...i,
      statusLabel:        INVOICE_STATUSES.find((s) => s.value === i.status)?.label ?? i.status,
      paymentMethodLabel: PAYMENT_METHODS.find((m) => m.value === i.payment_method)?.label ?? i.payment_method,
    }));
  });

  // ── Synthèse des montants en attente ──────────────────────
  app.get('/summary', hooks, async (request) => {
    const q = request.query as { currency?: string };
    const [stats] = await sql<{
      total: string; pending_count: string; pending_amount: string;
      paid_count: string; paid_amount: string;
    }[]>`
      SELECT
        COUNT(*)                                                              as total,
        COUNT(*)       FILTER (WHERE status = 'pending')                     as pending_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)           as pending_amount,
        COUNT(*)       FILTER (WHERE status = 'paid')                        as paid_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)              as paid_amount
      FROM affiliate_invoices
      WHERE (${q.currency ?? null} IS NULL OR currency = ${q.currency ?? null})
    `;
    return {
      total:         Number(stats?.total ?? 0),
      pendingCount:  Number(stats?.pending_count ?? 0),
      pendingAmount: Number(stats?.pending_amount ?? 0),
      paidCount:     Number(stats?.paid_count ?? 0),
      paidAmount:    Number(stats?.paid_amount ?? 0),
    };
  });

  // ── Créer une facture ─────────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = invoiceSchema.parse(request.body);
    const [invoice] = await sql`
      INSERT INTO affiliate_invoices (
        affiliate_id, period_start, period_end,
        amount, currency, payment_method, notes
      ) VALUES (
        ${body.affiliateId}, ${body.periodStart}, ${body.periodEnd},
        ${body.amount}, ${body.currency},
        ${body.paymentMethod ?? null}, ${body.notes ?? null}
      )
      RETURNING *
    `;
    return reply.status(201).send(invoice);
  });

  // ── Détail ────────────────────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [invoice] = await sql`
      SELECT ai.*, c.email, c.first_name, c.last_name, c.phone
      FROM affiliate_invoices ai
      LEFT JOIN contacts c ON c.id = ai.affiliate_id
      WHERE ai.id = ${id}
    `;
    if (!invoice) return reply.status(404).send({ error: 'not_found' });
    return invoice;
  });

  // ── Modifier ──────────────────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = invoiceSchema.partial().extend({
      paymentReference: z.string().optional(),
    }).parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.amount        !== undefined) cols.amount           = body.amount;
    if (body.currency      !== undefined) cols.currency         = body.currency;
    if (body.paymentMethod !== undefined) cols.payment_method   = body.paymentMethod;
    if ('paymentReference' in body)       cols.payment_reference = body.paymentReference;
    if (body.notes         !== undefined) cols.notes            = body.notes;
    const [updated] = await sql`UPDATE affiliate_invoices SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Payer une facture ─────────────────────────────────────
  app.post('/:id/pay', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { paymentReference, paymentMethod } = request.body as {
      paymentReference?: string; paymentMethod?: string;
    };
    const [updated] = await sql`
      UPDATE affiliate_invoices
      SET status = 'paid', paid_at = now(), updated_at = now(),
          payment_reference = ${paymentReference ?? null},
          payment_method    = ${paymentMethod ?? null}
      WHERE id = ${id} AND status IN ('pending', 'processing')
      RETURNING *
    `;
    if (!updated) return reply.status(400).send({ error: 'not_payable', message: 'Facture déjà payée ou rejetée' });
    return updated;
  });

  // ── Payer toutes les factures en attente (Payer les factures) ─
  app.post('/pay-all', hooks, async (request) => {
    const { paymentMethod, currency } = request.body as {
      paymentMethod?: string; currency?: string;
    };
    const updated = await sql`
      UPDATE affiliate_invoices
      SET status = 'processing', updated_at = now(),
          payment_method = COALESCE(${paymentMethod ?? null}, payment_method)
      WHERE status = 'pending'
        AND (${currency ?? null} IS NULL OR currency = ${currency ?? null})
      RETURNING id, affiliate_id, amount, currency
    `;
    return { processed: updated.length, invoices: updated };
  });

  // ── Rejeter une facture ───────────────────────────────────
  app.post('/:id/reject', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason?: string };
    const [updated] = await sql`
      UPDATE affiliate_invoices
      SET status = 'rejected', notes = COALESCE(notes || ' | ', '') || ${reason ?? 'Rejeté'},
          updated_at = now()
      WHERE id = ${id} AND status = 'pending'
      RETURNING id, status
    `;
    if (!updated) return reply.status(400).send({ error: 'not_rejectable' });
    return updated;
  });

  // ── Supprimer ─────────────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [inv] = await sql`SELECT status FROM affiliate_invoices WHERE id = ${id}`;
    if (!inv) return reply.status(404).send({ error: 'not_found' });
    if (inv.status === 'paid') {
      return reply.status(400).send({ error: 'cannot_delete_paid', message: 'Impossible de supprimer une facture déjà payée' });
    }
    await sql`DELETE FROM affiliate_invoices WHERE id = ${id}`;
    return reply.status(204).send();
  });

  // ── Export CSV ────────────────────────────────────────────
  app.get('/export', hooks, async (request, reply) => {
    const q = request.query as { status?: string; dateFrom?: string; dateTo?: string };
    const rows = await sql`
      SELECT ai.id, c.email, c.first_name, c.last_name,
             ai.amount, ai.currency, ai.status, ai.payment_method,
             ai.payment_reference, ai.period_start, ai.period_end, ai.paid_at, ai.created_at
      FROM affiliate_invoices ai
      LEFT JOIN contacts c ON c.id = ai.affiliate_id
      WHERE (${q.status   ?? null} IS NULL OR ai.status      = ${q.status   ?? null})
        AND (${q.dateFrom ?? null} IS NULL OR ai.created_at >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo   ?? null} IS NULL OR ai.created_at <= ${q.dateTo   ?? null}::timestamptz)
      ORDER BY ai.created_at DESC
    `;
    const header = 'ID,Email,Prénom,Nom,Montant,Devise,Statut,Mode de paiement,Référence,Période début,Période fin,Payé le,Créé le\n';
    const csv = rows.map((r) =>
      [r.id, r.email ?? '', r.first_name ?? '', r.last_name ?? '',
       r.amount, r.currency, r.status, r.payment_method ?? '',
       r.payment_reference ?? '', r.period_start, r.period_end,
       r.paid_at ?? '', new Date(r.created_at).toISOString()].join(','),
    ).join('\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="factures-affilies.csv"');
    return reply.send(header + csv);
  });
}
