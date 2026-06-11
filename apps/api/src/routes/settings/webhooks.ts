import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export const WEBHOOK_EVENTS = [
  'contact_created',
  'tag_added',
  'tag_removed',
  'opt_in',
  'new_sale',
  'sale_cancelled',
  'subscription_created',
  'subscription_cancelled',
  'order_paid',
  'order_refunded',
] as const;

const webhookSchema = z.object({
  name:     z.string().max(100).optional(),
  url:      z.string().url(),
  secret:   z.string().min(8).max(100),
  isActive: z.boolean().default(true),
  events:   z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

export default async function webhooksRoutes(app: FastifyInstance) {

  // ── Liste des webhooks ────────────────────────────────────────
  app.get('/webhooks', hooks, async () => {
    return sql`SELECT * FROM webhooks ORDER BY created_at DESC`;
  });

  // ── Créer un webhook ──────────────────────────────────────────
  app.post('/webhooks', hooks, async (request, reply) => {
    const body = webhookSchema.parse(request.body);
    const [created] = await sql`
      INSERT INTO webhooks (name, url, secret, is_active, events)
      VALUES (
        ${body.name ?? null}, ${body.url}, ${body.secret},
        ${body.isActive}, ${JSON.stringify(body.events)}::jsonb
      )
      RETURNING *
    `;
    return reply.status(201).send(created);
  });

  // ── Modifier un webhook ───────────────────────────────────────
  app.patch('/webhooks/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = webhookSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.name     !== undefined) cols.name      = body.name;
    if (body.url      !== undefined) cols.url       = body.url;
    if (body.secret   !== undefined) cols.secret    = body.secret;
    if (body.isActive !== undefined) cols.is_active = body.isActive;
    if (body.events   !== undefined) cols.events    = JSON.stringify(body.events);
    const [updated] = await sql`UPDATE webhooks SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer un webhook ──────────────────────────────────────
  app.delete('/webhooks/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM webhooks WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── Historique des livraisons ─────────────────────────────────
  app.get('/webhooks/:id/deliveries', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { limit?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const deliveries = await sql`
      SELECT id, event_type, status, response_code, attempt_count, delivered_at, created_at
      FROM webhook_deliveries
      WHERE webhook_id = ${id}
        AND (${q.status ?? null} IS NULL OR status = ${q.status ?? null})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    if (!deliveries.length) {
      const [wh] = await sql`SELECT id FROM webhooks WHERE id = ${id}`;
      if (!wh) return reply.status(404).send({ error: 'not_found' });
    }
    return deliveries;
  });

  // ── Retenter une livraison ────────────────────────────────────
  app.post('/webhooks/:id/deliveries/:deliveryId/retry', hooks, async (request, reply) => {
    const { id, deliveryId } = request.params as { id: string; deliveryId: string };
    const [delivery] = await sql`
      SELECT * FROM webhook_deliveries WHERE id = ${deliveryId} AND webhook_id = ${id}
    `;
    if (!delivery) return reply.status(404).send({ error: 'not_found' });
    const [webhook] = await sql`SELECT * FROM webhooks WHERE id = ${id}`;
    if (!webhook) return reply.status(404).send({ error: 'webhook_not_found' });

    // Relancer l'envoi HTTP (fire-and-forget avec résultat synchrone ici pour la démo)
    let status: 'delivered' | 'failed' = 'failed';
    let responseCode = 0;
    let responseBody = '';

    try {
      const res = await fetch(webhook.url, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-AfriFlow-Secret': webhook.secret,
          'X-AfriFlow-Event':  delivery.event_type,
        },
        body:    JSON.stringify(delivery.payload ?? {}),
        signal:  AbortSignal.timeout(10_000),
      });
      status       = res.ok ? 'delivered' : 'failed';
      responseCode = res.status;
      responseBody = await res.text().catch(() => '');
    } catch (err) {
      responseBody = String(err);
    }

    await sql`
      UPDATE webhook_deliveries
      SET status = ${status}, response_code = ${responseCode},
          response_body = ${responseBody}, attempt_count = attempt_count + 1,
          delivered_at = ${status === 'delivered' ? new Date() : null}
      WHERE id = ${deliveryId}
    `;
    await sql`
      UPDATE webhooks
      SET ${status === 'delivered' ? sql`delivery_count = delivery_count + 1` : sql`failure_count = failure_count + 1`},
          last_triggered_at = now(), updated_at = now()
      WHERE id = ${id}
    `;

    return { status, responseCode, responseBody };
  });

  // ── Événements disponibles ────────────────────────────────────
  app.get('/webhooks/events', hooks, async () => {
    return {
      events: WEBHOOK_EVENTS.map((e) => ({
        key:         e,
        label:       e.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      })),
    };
  });
}

// ── Utilitaire : déclencher un webhook depuis d'autres modules ───
export async function fireWebhooks(
  tenantSchema: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const webhooks = await sql.unsafe(`
      SET search_path = "${tenantSchema}", public;
      SELECT * FROM webhooks WHERE is_active = true AND events @> '["${eventType}"]'::jsonb
    `);

    for (const webhook of webhooks as unknown as { id: string; url: string; secret: string }[]) {
      const deliveryId = crypto.randomUUID();
      let status: 'delivered' | 'failed' = 'failed';
      let responseCode = 0;
      try {
        const res = await fetch(webhook.url, {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'X-AfriFlow-Secret': webhook.secret,
            'X-AfriFlow-Event':  eventType,
            'X-AfriFlow-Id':     deliveryId,
          },
          body:   JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        status       = res.ok ? 'delivered' : 'failed';
        responseCode = res.status;
      } catch { /* ignore */ }

      await sql.unsafe(`
        INSERT INTO "${tenantSchema}".webhook_deliveries (id, webhook_id, event_type, payload, status, response_code, delivered_at)
        VALUES ('${deliveryId}', '${webhook.id}', '${eventType}',
                '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb,
                '${status}', ${responseCode},
                ${status === 'delivered' ? 'now()' : 'NULL'})
      `);
    }
  } catch { /* silently ignore */ }
}
