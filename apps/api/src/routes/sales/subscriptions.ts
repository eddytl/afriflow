import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const SUBSCRIPTION_STATUSES = [
  { value: 'active',    label: 'Actif' },
  { value: 'trial',     label: 'Période d\'essai' },
  { value: 'past_due',  label: 'Paiement en retard' },
  { value: 'paused',    label: 'En pause' },
  { value: 'cancelled', label: 'Annulé' },
  { value: 'expired',   label: 'Expiré' },
] as const;

const BILLING_INTERVALS = [
  { value: 'weekly',    label: 'Hebdomadaire' },
  { value: 'monthly',   label: 'Mensuel' },
  { value: 'quarterly', label: 'Trimestriel' },
  { value: 'yearly',    label: 'Annuel' },
] as const;

export default async function subscriptionsRoutes(app: FastifyInstance) {

  // ── Méta ──────────────────────────────────────────────────
  app.get('/statuses',  hooks, async () => SUBSCRIPTION_STATUSES);
  app.get('/intervals', hooks, async () => BILLING_INTERVALS);

  // ── Plans disponibles (déduit des abonnements existants) ──
  app.get('/plans', hooks, async () => {
    return sql`
      SELECT DISTINCT plan_id, plan_name,
             billing_interval, currency, amount
      FROM subscriptions
      WHERE plan_id IS NOT NULL
      ORDER BY plan_name
    `;
  });

  // ── Liste avec filtres ────────────────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as {
      status?:   string;
      planId?:   string;
      planName?: string;
      email?:    string;
      currency?: string;
      after?:    string;
      limit?:    string;
    };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    const rows = await sql`
      SELECT s.*,
             c.email, c.first_name, c.last_name, c.phone
      FROM subscriptions s
      LEFT JOIN contacts c ON c.id = s.contact_id
      WHERE (${q.status   ?? null} IS NULL OR s.status    = ${q.status   ?? null})
        AND (${q.planId   ?? null}::uuid IS NULL OR s.plan_id = ${q.planId ?? null}::uuid)
        AND (${q.planName ?? null} IS NULL OR s.plan_name ILIKE ${'%' + (q.planName ?? '') + '%'})
        AND (${q.currency ?? null} IS NULL OR s.currency  = ${q.currency ?? null})
        AND (${q.email    ?? null} IS NULL OR c.email     ILIKE ${'%' + (q.email    ?? '') + '%'})
        AND (${q.after    ?? null}::uuid IS NULL OR s.id > ${q.after ?? null}::uuid)
      ORDER BY s.created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((s) => ({
      ...s,
      statusLabel:   SUBSCRIPTION_STATUSES.find((x) => x.value === s.status)?.label ?? s.status,
      intervalLabel: BILLING_INTERVALS.find((x) => x.value === s.billing_interval)?.label ?? s.billing_interval,
    }));
  });

  // ── Créer un abonnement (manuel / via webhook) ────────────
  app.post('/', hooks, async (request, reply) => {
    const body = z.object({
      contactId:               z.string().uuid(),
      planName:                z.string().min(1),
      planId:                  z.string().uuid().optional(),
      currency:                z.string().length(3).default('XAF'),
      amount:                  z.number().min(0),
      billingInterval:         z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
      billingDay:              z.number().int().min(1).max(31).optional(),
      trialEndsAt:             z.string().datetime().optional(),
      currentPeriodStart:      z.string().datetime().optional(),
      currentPeriodEnd:        z.string().datetime().optional(),
      provider:                z.string().optional(),
      providerSubscriptionId:  z.string().optional(),
    }).parse(request.body);

    const [sub] = await sql`
      INSERT INTO subscriptions (
        contact_id, plan_name, plan_id, currency, amount,
        billing_interval, billing_day, trial_ends_at,
        current_period_start, current_period_end,
        provider, provider_subscription_id
      ) VALUES (
        ${body.contactId}, ${body.planName}, ${body.planId ?? null},
        ${body.currency}, ${body.amount}, ${body.billingInterval},
        ${body.billingDay ?? null}, ${body.trialEndsAt ?? null},
        ${body.currentPeriodStart ?? null}, ${body.currentPeriodEnd ?? null},
        ${body.provider ?? null}, ${body.providerSubscriptionId ?? null}
      )
      RETURNING *
    `;
    return reply.status(201).send(sub);
  });

  // ── Détail d'un abonnement ────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [sub] = await sql`
      SELECT s.*, c.email, c.first_name, c.last_name, c.phone
      FROM subscriptions s LEFT JOIN contacts c ON c.id = s.contact_id
      WHERE s.id = ${id}
    `;
    if (!sub) return reply.status(404).send({ error: 'not_found' });

    // Historique des paiements liés (via transactions public)
    const payments = await sql`
      SELECT id, amount, currency, status, provider, provider_ref, created_at
      FROM public.payment_transactions
      WHERE metadata->>'subscriptionId' = ${id}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    return {
      ...sub,
      statusLabel:   SUBSCRIPTION_STATUSES.find((x) => x.value === sub.status)?.label,
      intervalLabel: BILLING_INTERVALS.find((x) => x.value === sub.billing_interval)?.label,
      payments,
    };
  });

  // ── Annuler ───────────────────────────────────────────────
  app.post('/:id/cancel', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { immediately } = request.body as { immediately?: boolean };
    const [sub] = await sql`SELECT status, current_period_end FROM subscriptions WHERE id = ${id}`;
    if (!sub) return reply.status(404).send({ error: 'not_found' });
    if (sub.status === 'cancelled') {
      return reply.status(400).send({ error: 'already_cancelled' });
    }
    const [updated] = await sql`
      UPDATE subscriptions
      SET status = 'cancelled', cancelled_at = now(), updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    return updated;
  });

  // ── Mettre en pause ───────────────────────────────────────
  app.post('/:id/pause', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { pauseEndsAt } = request.body as { pauseEndsAt?: string };
    const [updated] = await sql`
      UPDATE subscriptions
      SET status = 'paused', pause_starts_at = now(),
          pause_ends_at = ${pauseEndsAt ?? null},
          updated_at = now()
      WHERE id = ${id} AND status = 'active'
      RETURNING id, status, pause_starts_at, pause_ends_at
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found_or_not_active' });
    return updated;
  });

  // ── Reprendre ─────────────────────────────────────────────
  app.post('/:id/resume', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await sql`
      UPDATE subscriptions
      SET status = 'active', pause_starts_at = NULL, pause_ends_at = NULL, updated_at = now()
      WHERE id = ${id} AND status = 'paused'
      RETURNING id, status
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found_or_not_paused' });
    return updated;
  });

  // ── Stats ─────────────────────────────────────────────────
  app.get('/stats/overview', hooks, async (request) => {
    const q = request.query as { currency?: string };
    const [stats] = await sql<{
      total: string; active: string; trial: string;
      past_due: string; paused: string; cancelled: string;
      mrr: string;
    }[]>`
      SELECT
        COUNT(*)                                                as total,
        COUNT(*) FILTER (WHERE status = 'active')              as active,
        COUNT(*) FILTER (WHERE status = 'trial')               as trial,
        COUNT(*) FILTER (WHERE status = 'past_due')            as past_due,
        COUNT(*) FILTER (WHERE status = 'paused')              as paused,
        COUNT(*) FILTER (WHERE status = 'cancelled')           as cancelled,
        COALESCE(SUM(CASE
          WHEN billing_interval = 'monthly'   THEN amount
          WHEN billing_interval = 'yearly'    THEN amount / 12
          WHEN billing_interval = 'quarterly' THEN amount / 3
          WHEN billing_interval = 'weekly'    THEN amount * 4
          ELSE 0 END) FILTER (WHERE status IN ('active', 'trial')), 0) as mrr
      FROM subscriptions
      WHERE (${q.currency ?? null} IS NULL OR currency = ${q.currency ?? null})
    `;
    return {
      total:     Number(stats?.total ?? 0),
      active:    Number(stats?.active ?? 0),
      trial:     Number(stats?.trial ?? 0),
      pastDue:   Number(stats?.past_due ?? 0),
      paused:    Number(stats?.paused ?? 0),
      cancelled: Number(stats?.cancelled ?? 0),
      mrr:       Number(stats?.mrr ?? 0),
    };
  });

  // ── Export CSV ────────────────────────────────────────────
  app.get('/export', hooks, async (request, reply) => {
    const q = request.query as { status?: string; planId?: string };
    const rows = await sql`
      SELECT s.plan_name, s.billing_interval, s.amount, s.currency,
             s.status, s.current_period_end, s.cancelled_at, s.created_at,
             c.email, c.first_name, c.last_name
      FROM subscriptions s
      LEFT JOIN contacts c ON c.id = s.contact_id
      WHERE (${q.status ?? null} IS NULL OR s.status  = ${q.status ?? null})
        AND (${q.planId ?? null}::uuid IS NULL OR s.plan_id = ${q.planId ?? null}::uuid)
      ORDER BY s.created_at DESC
    `;
    const header = 'Email,Prénom,Nom,Plan,Intervalle,Montant,Devise,Statut,Prochaine facturation,Annulé le,Créé le\n';
    const csv = rows.map((r) =>
      [r.email ?? '', r.first_name ?? '', r.last_name ?? '',
       r.plan_name, r.billing_interval, r.amount, r.currency,
       r.status, r.current_period_end ?? '', r.cancelled_at ?? '',
       new Date(r.created_at).toISOString()].join(','),
    ).join('\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="abonnements.csv"');
    return reply.send(header + csv);
  });
}
