import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const couponSchema = z.object({
  name:           z.string().min(1),
  code:           z.string().min(1).transform((s) => s.toUpperCase().trim()),
  discountType:   z.enum(['percentage', 'fixed']),
  discountAmount: z.number().min(0),
  expiresAt:      z.string().datetime().optional(),
  maxUses:        z.number().int().min(1).optional(),
});

export default async function couponsRoutes(app: FastifyInstance) {

  // ── Liste avec recherche / filtre ─────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as {
      status?: string;
      search?: string;
      discountType?: string;
      after?: string;
      limit?: string;
    };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT * FROM coupons
      WHERE (${q.status       ?? null} IS NULL OR status        = ${q.status       ?? null})
        AND (${q.discountType ?? null} IS NULL OR discount_type = ${q.discountType ?? null})
        AND (${q.search       ?? null} IS NULL OR (
              name ILIKE ${'%' + (q.search ?? '') + '%'} OR
              code ILIKE ${'%' + (q.search ?? '') + '%'}
            ))
        AND (${q.after ?? null}::uuid IS NULL OR id > ${q.after ?? null}::uuid)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Créer ─────────────────────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = couponSchema.parse(request.body);

    // Vérifier l'unicité du code
    const [existing] = await sql`SELECT id FROM coupons WHERE code = ${body.code}`;
    if (existing) {
      return reply.status(409).send({ error: 'code_already_exists', message: `Le code "${body.code}" existe déjà` });
    }

    // Valider le taux pour percentage
    if (body.discountType === 'percentage' && body.discountAmount > 100) {
      return reply.status(400).send({ error: 'invalid_percentage', message: 'Le taux de réduction ne peut pas dépasser 100%' });
    }

    const [coupon] = await sql`
      INSERT INTO coupons (name, code, discount_type, discount_amount, expires_at, max_uses)
      VALUES (
        ${body.name},
        ${body.code},
        ${body.discountType},
        ${body.discountAmount},
        ${body.expiresAt ?? null},
        ${body.maxUses ?? null}
      )
      RETURNING *
    `;
    return reply.status(201).send(coupon);
  });

  // ── Détail ────────────────────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [coupon] = await sql`SELECT * FROM coupons WHERE id = ${id}`;
    if (!coupon) return reply.status(404).send({ error: 'not_found' });
    return coupon;
  });

  // ── Modifier ──────────────────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = couponSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.name           !== undefined) cols.name            = body.name;
    if (body.code           !== undefined) cols.code            = body.code;
    if (body.discountType   !== undefined) cols.discount_type   = body.discountType;
    if (body.discountAmount !== undefined) cols.discount_amount = body.discountAmount;
    if (body.expiresAt      !== undefined) cols.expires_at      = body.expiresAt;
    if (body.maxUses        !== undefined) cols.max_uses        = body.maxUses;
    const [updated] = await sql`UPDATE coupons SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Activer / Mettre en pause ─────────────────────────────
  app.post('/:id/toggle', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await sql`
      UPDATE coupons
      SET status = CASE WHEN status = 'active' THEN 'paused' ELSE 'active' END,
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, code, status
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer ─────────────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM coupons WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── Valider un code au moment du checkout (PUBLIC) ────────
  app.get('/validate/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    const { tenantSchema } = request.query as { tenantSchema?: string };
    if (!tenantSchema) return reply.status(400).send({ error: 'tenantSchema_required' });

    await sql.unsafe(`SET search_path = "${tenantSchema}", public`);

    const [coupon] = await sql`
      SELECT id, name, code, discount_type, discount_amount, expires_at, max_uses, use_count, status
      FROM coupons WHERE code = ${code.toUpperCase()} LIMIT 1
    `;

    if (!coupon) return reply.status(404).send({ valid: false, error: 'not_found' });
    if (coupon.status !== 'active') return { valid: false, error: 'inactive' };
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return { valid: false, error: 'expired' };
    }
    if (coupon.max_uses && coupon.use_count >= coupon.max_uses) {
      return { valid: false, error: 'max_uses_reached' };
    }

    return {
      valid: true,
      coupon: {
        id:             coupon.id,
        code:           coupon.code,
        discountType:   coupon.discount_type,
        discountAmount: Number(coupon.discount_amount),
      },
    };
  });

  // ── Appliquer un coupon (incrémenter use_count) ───────────
  app.post('/apply/:code', hooks, async (request, reply) => {
    const { code } = request.params as { code: string };
    const [updated] = await sql`
      UPDATE coupons SET use_count = use_count + 1, updated_at = now()
      WHERE code = ${code.toUpperCase()} AND status = 'active'
      RETURNING id, use_count
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found_or_inactive' });
    return updated;
  });

  // ── Stats d'utilisation ───────────────────────────────────
  app.get('/:id/stats', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [coupon] = await sql`SELECT * FROM coupons WHERE id = ${id}`;
    if (!coupon) return reply.status(404).send({ error: 'not_found' });
    return {
      id:            coupon.id,
      code:          coupon.code,
      useCount:      coupon.use_count,
      maxUses:       coupon.max_uses,
      remaining:     coupon.max_uses ? coupon.max_uses - coupon.use_count : null,
      usageRate:     coupon.max_uses ? Math.round((coupon.use_count / coupon.max_uses) * 100) : null,
      isExpired:     coupon.expires_at ? new Date(coupon.expires_at) < new Date() : false,
      expiresAt:     coupon.expires_at,
    };
  });
}
