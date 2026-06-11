import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const orderItemSchema = z.object({
  offerType:  z.enum(['product', 'funnel_offer', 'subscription_plan']).default('product'),
  offerId:    z.string().uuid().optional(),
  name:       z.string().min(1),
  quantity:   z.number().int().min(1).default(1),
  unitPrice:  z.number().min(0),
});

const createOrderSchema = z.object({
  contactId:     z.string().uuid().optional(),
  currency:      z.string().length(3).default('XAF'),
  couponId:      z.string().uuid().optional(),
  source:        z.enum(['funnel', 'store', 'manual', 'api']).default('manual'),
  sourceId:      z.string().uuid().optional(),
  notes:         z.string().optional(),
  items:         z.array(orderItemSchema).min(1),
  taxRate:       z.number().min(0).max(100).optional().default(0),
  discountAmount: z.number().min(0).optional().default(0),
});

export default async function ordersRoutes(app: FastifyInstance) {

  // ── Liste avec filtres ────────────────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as {
      status?:    string;
      productId?: string;
      offerId?:   string;
      dateFrom?:  string;
      dateTo?:    string;
      search?:    string;
      after?:     string;
      limit?:     string;
    };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    return sql`
      SELECT
        o.*,
        c.email         as contact_email,
        c.first_name,
        c.last_name,
        COALESCE(
          (SELECT json_agg(row_to_json(oi)) FROM order_items oi WHERE oi.order_id = o.id),
          '[]'::json
        ) as items
      FROM orders o
      LEFT JOIN contacts c ON c.id = o.contact_id
      WHERE (${q.status   ?? null} IS NULL OR o.status = ${q.status ?? null})
        AND (${q.dateFrom ?? null} IS NULL OR o.created_at >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo   ?? null} IS NULL OR o.created_at <= ${q.dateTo   ?? null}::timestamptz)
        AND (${q.search   ?? null} IS NULL OR (
              o.order_number ILIKE ${'%' + (q.search ?? '') + '%'} OR
              c.email        ILIKE ${'%' + (q.search ?? '') + '%'} OR
              c.first_name   ILIKE ${'%' + (q.search ?? '') + '%'} OR
              c.last_name    ILIKE ${'%' + (q.search ?? '') + '%'}
            ))
        AND (${q.after ?? null}::uuid IS NULL OR o.id > ${q.after ?? null}::uuid)
      ORDER BY o.created_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Stats / synthèse ──────────────────────────────────────
  app.get('/stats', hooks, async (request) => {
    const q = request.query as { dateFrom?: string; dateTo?: string; currency?: string };
    const [stats] = await sql<{
      total: string; pending: string; paid: string; refunded: string; cancelled: string;
      total_revenue: string; avg_order: string;
    }[]>`
      SELECT
        COUNT(*)                                              as total,
        COUNT(*) FILTER (WHERE status = 'pending')           as pending,
        COUNT(*) FILTER (WHERE status = 'paid')              as paid,
        COUNT(*) FILTER (WHERE status = 'refunded')          as refunded,
        COUNT(*) FILTER (WHERE status = 'cancelled')         as cancelled,
        COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) as total_revenue,
        COALESCE(AVG(total) FILTER (WHERE status = 'paid'), 0) as avg_order
      FROM orders
      WHERE (${q.dateFrom ?? null} IS NULL OR created_at >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo   ?? null} IS NULL OR created_at <= ${q.dateTo   ?? null}::timestamptz)
        AND (${q.currency ?? null} IS NULL OR currency    = ${q.currency ?? null})
    `;
    return {
      total:        Number(stats?.total ?? 0),
      pending:      Number(stats?.pending ?? 0),
      paid:         Number(stats?.paid ?? 0),
      refunded:     Number(stats?.refunded ?? 0),
      cancelled:    Number(stats?.cancelled ?? 0),
      totalRevenue: Number(stats?.total_revenue ?? 0),
      avgOrder:     Number(stats?.avg_order ?? 0),
    };
  });

  // ── Créer une commande manuelle ───────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = createOrderSchema.parse(request.body);

    // Calculer les montants
    const subtotal = body.items.reduce((s, item) => s + item.unitPrice * item.quantity, 0);
    const taxAmount = Math.round(subtotal * (body.taxRate / 100) * 100) / 100;
    const total = subtotal + taxAmount - (body.discountAmount ?? 0);

    // Générer le numéro de commande
    const [{ nextval }] = await sql<{ nextval: string }[]>`SELECT nextval('order_number_seq')`;
    const orderNumber = `ORD-${new Date().getFullYear()}-${String(nextval).padStart(5, '0')}`;

    const [order] = await sql`
      INSERT INTO orders (
        order_number, contact_id, currency, coupon_id, source, source_id,
        notes, subtotal, tax_amount, discount_amount, total, status
      ) VALUES (
        ${orderNumber},
        ${body.contactId ?? null},
        ${body.currency},
        ${body.couponId ?? null},
        ${body.source},
        ${body.sourceId ?? null},
        ${body.notes ?? null},
        ${subtotal}, ${taxAmount}, ${body.discountAmount ?? 0}, ${total},
        'pending'
      )
      RETURNING *
    `;

    // Insérer les lignes
    for (const item of body.items) {
      await sql`
        INSERT INTO order_items (order_id, offer_type, offer_id, name, quantity, unit_price, total)
        VALUES (
          ${order.id}, ${item.offerType}, ${item.offerId ?? null},
          ${item.name}, ${item.quantity}, ${item.unitPrice},
          ${item.unitPrice * item.quantity}
        )
      `;
    }

    // Appliquer le coupon si présent
    if (body.couponId) {
      await sql`UPDATE coupons SET use_count = use_count + 1, updated_at = now() WHERE id = ${body.couponId}`;
    }

    return reply.status(201).send({ ...order, items: body.items });
  });

  // ── Détail d'une commande ─────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [order] = await sql`
      SELECT o.*, c.email, c.first_name, c.last_name, c.phone, c.country
      FROM orders o LEFT JOIN contacts c ON c.id = o.contact_id
      WHERE o.id = ${id}
    `;
    if (!order) return reply.status(404).send({ error: 'not_found' });

    const items = await sql`SELECT * FROM order_items WHERE order_id = ${id} ORDER BY created_at`;
    return { ...order, items };
  });

  // ── Modifier le statut / les notes ────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      status: z.enum(['pending', 'paid', 'refunded', 'cancelled', 'partially_refunded']).optional(),
      notes:  z.string().optional(),
    }).parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.status !== undefined) cols.status = body.status;
    if (body.notes  !== undefined) cols.notes  = body.notes;
    const [updated] = await sql`UPDATE orders SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Rembourser ────────────────────────────────────────────
  app.post('/:id/refund', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { amount, reason } = request.body as { amount?: number; reason?: string };
    const [order] = await sql`SELECT status, total FROM orders WHERE id = ${id}`;
    if (!order) return reply.status(404).send({ error: 'not_found' });
    if (order.status !== 'paid') {
      return reply.status(400).send({ error: 'order_not_paid', message: 'Seules les commandes payées peuvent être remboursées' });
    }
    const refundAmount = amount ?? Number(order.total);
    const newStatus = refundAmount >= Number(order.total) ? 'refunded' : 'partially_refunded';
    const [updated] = await sql`
      UPDATE orders SET status = ${newStatus},
        notes = COALESCE(notes || ' | ', '') || ${'Remboursement: ' + (reason ?? 'Manuel') + ` (${refundAmount})`},
        updated_at = now()
      WHERE id = ${id} RETURNING *
    `;
    return updated;
  });

  // ── Export CSV ────────────────────────────────────────────
  app.get('/export', hooks, async (request, reply) => {
    const q = request.query as { status?: string; dateFrom?: string; dateTo?: string };
    const rows = await sql`
      SELECT o.order_number, c.email, c.first_name, c.last_name,
             o.total, o.currency, o.status, o.source, o.created_at
      FROM orders o
      LEFT JOIN contacts c ON c.id = o.contact_id
      WHERE (${q.status   ?? null} IS NULL OR o.status      = ${q.status   ?? null})
        AND (${q.dateFrom ?? null} IS NULL OR o.created_at >= ${q.dateFrom ?? null}::timestamptz)
        AND (${q.dateTo   ?? null} IS NULL OR o.created_at <= ${q.dateTo   ?? null}::timestamptz)
      ORDER BY o.created_at DESC
    `;

    const header = 'Numéro,Email,Prénom,Nom,Total,Devise,Statut,Source,Date\n';
    const csv = rows.map((r) =>
      [r.order_number, r.email ?? '', r.first_name ?? '', r.last_name ?? '',
       r.total, r.currency, r.status, r.source,
       new Date(r.created_at).toISOString()].join(','),
    ).join('\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="commandes.csv"');
    return reply.send(header + csv);
  });
}
