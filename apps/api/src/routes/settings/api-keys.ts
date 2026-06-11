import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';
import crypto from 'crypto';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export default async function apiKeysRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════════════════════════
  // API Keys (clés publiques)
  // ═══════════════════════════════════════════════════════════════

  app.get('/api-keys', hooks, async () => {
    return sql`
      SELECT id, name, token_prefix, expires_at, status, last_used_at, created_at
      FROM api_keys
      ORDER BY created_at DESC
    `;
  });

  app.post('/api-keys', hooks, async (request, reply) => {
    const body = z.object({
      name:      z.string().min(1).max(100),
      expiresAt: z.string().datetime().optional(),
    }).parse(request.body);

    const token  = `ak_${crypto.randomBytes(32).toString('hex')}`;
    const hash   = hashToken(token);
    const prefix = token.slice(0, 12);

    const [created] = await sql`
      INSERT INTO api_keys (name, token_prefix, token_hash, expires_at)
      VALUES (${body.name}, ${prefix}, ${hash}, ${body.expiresAt ?? null})
      RETURNING id, name, token_prefix, expires_at, status, created_at
    `;

    // Token retourné UNE SEULE FOIS — ne peut plus être récupéré
    return reply.status(201).send({ ...created, token });
  });

  app.delete('/api-keys/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [key] = await sql`UPDATE api_keys SET status = 'revoked' WHERE id = ${id} RETURNING id`;
    if (!key) return reply.status(404).send({ error: 'not_found' });
    return reply.status(204).send();
  });

  // ═══════════════════════════════════════════════════════════════
  // MCP Keys (max 2 par tenant)
  // ═══════════════════════════════════════════════════════════════

  app.get('/mcp-keys', hooks, async () => {
    return sql`
      SELECT id, name, token_prefix, expires_at, status, last_used_at, created_at
      FROM mcp_keys
      ORDER BY created_at DESC
    `;
  });

  app.post('/mcp-keys', hooks, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1).max(100),
    }).parse(request.body);

    // Vérifier la limite de 2 clés actives
    const [count] = await sql<{ total: string }[]>`
      SELECT COUNT(*) as total FROM mcp_keys WHERE status = 'active'
    `;
    if (Number(count?.total ?? 0) >= 2) {
      return reply.status(400).send({
        error:   'limit_reached',
        message: 'Maximum 2 clés MCP actives. Révoquez une clé existante avant d\'en créer une nouvelle.',
      });
    }

    const token  = `mcp_${crypto.randomBytes(32).toString('hex')}`;
    const hash   = hashToken(token);
    const prefix = token.slice(0, 12);

    const [created] = await sql`
      INSERT INTO mcp_keys (name, token_prefix, token_hash)
      VALUES (${body.name}, ${prefix}, ${hash})
      RETURNING id, name, token_prefix, expires_at, status, created_at
    `;

    return reply.status(201).send({ ...created, token });
  });

  app.delete('/mcp-keys/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [key] = await sql`UPDATE mcp_keys SET status = 'revoked' WHERE id = ${id} RETURNING id`;
    if (!key) return reply.status(404).send({ error: 'not_found' });
    return reply.status(204).send();
  });
}
