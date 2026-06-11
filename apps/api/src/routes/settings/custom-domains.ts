import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function customDomainsRoutes(app: FastifyInstance) {

  // ── Liste des domaines personnalisés ──────────────────────────
  app.get('/custom-domains', hooks, async () => {
    return sql`SELECT * FROM custom_domains WHERE type != 'email' ORDER BY created_at DESC`;
  });

  // ── Ajouter un domaine ────────────────────────────────────────
  app.post('/custom-domains', hooks, async (request, reply) => {
    const body = z.object({
      domain: z.string().min(3).max(255),
      type:   z.enum(['site', 'funnel']).default('site'),
    }).parse(request.body);

    const [existing] = await sql`SELECT id FROM custom_domains WHERE domain = ${body.domain}`;
    if (existing) return reply.status(409).send({ error: 'already_exists' });

    // Enregistrement CNAME requis
    const dnsRecords = [
      {
        type:    'CNAME',
        host:    body.domain,
        value:   'custom.afriflow.app',
        purpose: 'Domain Mapping',
      },
    ];

    const [created] = await sql`
      INSERT INTO custom_domains (domain, type, dns_records)
      VALUES (${body.domain}, ${body.type}, ${JSON.stringify(dnsRecords)}::jsonb)
      RETURNING *
    `;
    return reply.status(201).send(created);
  });

  // ── Vérifier la propagation DNS ───────────────────────────────
  app.post('/custom-domains/:id/verify', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [domain] = await sql`SELECT * FROM custom_domains WHERE id = ${id}`;
    if (!domain) return reply.status(404).send({ error: 'not_found' });

    // En production : vérification DNS réelle
    // Simulation : marquer comme actif
    const [updated] = await sql`
      UPDATE custom_domains
      SET status = 'active', verified_at = now(), updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    return updated;
  });

  // ── Supprimer un domaine ──────────────────────────────────────
  app.delete('/custom-domains/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM custom_domains WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });
}
