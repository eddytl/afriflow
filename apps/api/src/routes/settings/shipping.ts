import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };
const auth  = { preHandler: [authMiddleware] };

const rateSchema = z.object({
  name:           z.string().min(1),
  price:          z.number().min(0),
  minWeightGrams: z.number().int().min(0).default(0),
  maxWeightGrams: z.number().int().min(0).optional(),
  estimatedDays:  z.string().max(50).optional(),
});

const zoneSchema = z.object({
  name:      z.string().min(1).max(100),
  countries: z.array(z.string().length(2)).min(1),
  rates:     z.array(rateSchema).default([]),
  isActive:  z.boolean().default(true),
  position:  z.number().int().min(0).default(0),
});

export default async function shippingRoutes(app: FastifyInstance) {

  // ── État global + liste des zones ─────────────────────────────
  app.get('/shipping', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const [tenant] = await sql<{ settings: Record<string, unknown> }[]>`
      SELECT settings FROM public.tenants WHERE id = ${tenantId}
    `;
    const settings        = (tenant?.settings ?? {}) as Record<string, unknown>;
    const shippingEnabled = Boolean(settings.shippingEnabled ?? false);

    const zones = await sql`SELECT * FROM shipping_zones ORDER BY position, created_at`;
    return { enabled: shippingEnabled, zones };
  });

  // ── Activer / désactiver la livraison ─────────────────────────
  app.patch('/shipping', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    const [tenant] = await sql<{ settings: Record<string, unknown> }[]>`
      SELECT settings FROM public.tenants WHERE id = ${tenantId}
    `;
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    await sql`
      UPDATE public.tenants
      SET settings = ${JSON.stringify({ ...settings, shippingEnabled: enabled })}::jsonb, updated_at = now()
      WHERE id = ${tenantId}
    `;
    return { enabled };
  });

  // ── Créer une zone ────────────────────────────────────────────
  app.post('/shipping/zones', hooks, async (request, reply) => {
    const body = zoneSchema.parse(request.body);
    const [zone] = await sql`
      INSERT INTO shipping_zones (name, countries, rates, is_active, position)
      VALUES (
        ${body.name},
        ${JSON.stringify(body.countries)}::jsonb,
        ${JSON.stringify(body.rates)}::jsonb,
        ${body.isActive},
        ${body.position}
      )
      RETURNING *
    `;
    return reply.status(201).send(zone);
  });

  // ── Modifier une zone ─────────────────────────────────────────
  app.patch('/shipping/zones/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = zoneSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.name      !== undefined) cols.name      = body.name;
    if (body.countries !== undefined) cols.countries = JSON.stringify(body.countries);
    if (body.rates     !== undefined) cols.rates     = JSON.stringify(body.rates);
    if (body.isActive  !== undefined) cols.is_active = body.isActive;
    if (body.position  !== undefined) cols.position  = body.position;
    const [updated] = await sql`UPDATE shipping_zones SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer une zone ────────────────────────────────────────
  app.delete('/shipping/zones/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM shipping_zones WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });
}
