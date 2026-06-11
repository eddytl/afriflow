import type { FastifyRequest, FastifyReply } from 'fastify';
import { sql } from '../lib/db.js';

export async function tenantMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenantId = (request.user as { tenantId: string }).tenantId;
  if (!tenantId) {
    return reply.status(400).send({ error: 'no_tenant', message: 'Tenant introuvable' });
  }
  const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
  // SET search_path isole toutes les requêtes DB dans le schema du tenant
  await sql.unsafe(`SET search_path = "${schemaName}", public`);
}
