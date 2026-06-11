import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const communitySchema = z.object({
  name:                z.string().min(1),
  domain:              z.string().optional(),
  path:                z.string().min(1).transform((s) => s.replace(/^\/+/, '').toLowerCase()),
  autoApproveMessages: z.boolean().optional().default(true),
});

export default async function communitiesRoutes(app: FastifyInstance) {

  // ── Liste ─────────────────────────────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as { status?: string; search?: string; after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT * FROM communities
      WHERE (${q.status ?? null} IS NULL OR status = ${q.status ?? null})
        AND (${q.search ?? null} IS NULL OR name ILIKE ${'%' + (q.search ?? '') + '%'})
        AND (${q.after  ?? null}::uuid IS NULL OR id > ${q.after ?? null}::uuid)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Créer ─────────────────────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = communitySchema.parse(request.body);

    // Chemin d'accès unique par tenant
    const [existing] = await sql`SELECT id FROM communities WHERE path = ${body.path}`;
    if (existing) {
      return reply.status(409).send({ error: 'path_already_exists', message: `Le chemin "/${body.path}" est déjà utilisé` });
    }

    const [community] = await sql`
      INSERT INTO communities (name, domain, path, auto_approve_messages)
      VALUES (${body.name}, ${body.domain ?? null}, ${body.path}, ${body.autoApproveMessages})
      RETURNING *
    `;
    return reply.status(201).send(community);
  });

  // ── Détail ────────────────────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [community] = await sql`SELECT * FROM communities WHERE id = ${id}`;
    if (!community) return reply.status(404).send({ error: 'not_found' });
    return community;
  });

  // ── Modifier ──────────────────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = communitySchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.name                !== undefined) cols.name                  = body.name;
    if (body.domain              !== undefined) cols.domain                = body.domain;
    if (body.path                !== undefined) cols.path                  = body.path;
    if (body.autoApproveMessages !== undefined) cols.auto_approve_messages = body.autoApproveMessages;
    const [updated] = await sql`UPDATE communities SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Archiver / Activer ────────────────────────────────────
  app.post('/:id/toggle', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await sql`
      UPDATE communities
      SET status = CASE WHEN status = 'active' THEN 'archived' ELSE 'active' END,
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, status
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer ─────────────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM communities WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── URL publique ──────────────────────────────────────────
  app.get('/:id/url', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [community] = await sql`SELECT domain, path FROM communities WHERE id = ${id}`;
    if (!community) return reply.status(404).send({ error: 'not_found' });
    const domain = community.domain ?? process.env.WEB_URL ?? 'https://app.afriflow.app';
    return { url: `${domain}/community/${community.path}` };
  });

  // ── Membres ───────────────────────────────────────────────
  app.get('/:id/members', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const q = request.query as { role?: string; status?: string; after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT cm.*, c.email, c.first_name, c.last_name, c.avatar_url
      FROM community_members cm
      LEFT JOIN contacts c ON c.id = cm.contact_id
      WHERE cm.community_id = ${id}
        AND (${q.role   ?? null} IS NULL OR cm.role   = ${q.role   ?? null})
        AND (${q.status ?? null} IS NULL OR cm.status = ${q.status ?? null})
        AND (${q.after  ?? null}::uuid IS NULL OR cm.id > ${q.after ?? null}::uuid)
      ORDER BY cm.joined_at DESC
      LIMIT ${limit}
    `;
  });

  // Ajouter un membre (depuis l'admin)
  app.post('/:id/members', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { contactId, role } = request.body as { contactId: string; role?: string };
    if (!contactId) return reply.status(400).send({ error: 'contactId_required' });

    const [member] = await sql`
      INSERT INTO community_members (community_id, contact_id, role)
      VALUES (${id}, ${contactId}, ${role ?? 'member'})
      ON CONFLICT (community_id, contact_id) DO UPDATE SET status = 'active'
      RETURNING *
    `;

    // Mettre à jour le compteur
    await sql`UPDATE communities SET member_count = member_count + 1, updated_at = now() WHERE id = ${id}`;
    return reply.status(201).send(member);
  });

  // Modifier le rôle d'un membre
  app.patch('/:id/members/:memberId', hooks, async (request, reply) => {
    const { memberId } = request.params as { id: string; memberId: string };
    const { role } = request.body as { role: string };
    if (!['member', 'moderator', 'admin'].includes(role)) {
      return reply.status(400).send({ error: 'invalid_role' });
    }
    const [updated] = await sql`
      UPDATE community_members SET role = ${role} WHERE id = ${memberId} RETURNING id, role
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // Bannir / Réactiver un membre
  app.post('/:id/members/:memberId/ban', hooks, async (request, reply) => {
    const { memberId } = request.params as { id: string; memberId: string };
    const [updated] = await sql`
      UPDATE community_members
      SET status = CASE WHEN status = 'banned' THEN 'active' ELSE 'banned' END
      WHERE id = ${memberId}
      RETURNING id, status
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // Supprimer un membre
  app.delete('/:id/members/:memberId', hooks, async (request, reply) => {
    const { id, memberId } = request.params as { id: string; memberId: string };
    await sql`DELETE FROM community_members WHERE id = ${memberId}`;
    await sql`UPDATE communities SET member_count = GREATEST(0, member_count - 1), updated_at = now() WHERE id = ${id}`;
    return reply.status(204).send();
  });

  // ── Stats ─────────────────────────────────────────────────
  app.get('/:id/stats', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [community] = await sql`SELECT * FROM communities WHERE id = ${id}`;
    if (!community) return reply.status(404).send({ error: 'not_found' });

    const [memberStats] = await sql<{ total: string; active: string; banned: string }[]>`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'banned') as banned
      FROM community_members WHERE community_id = ${id}
    `;
    const [roleStats] = await sql<{ members: string; moderators: string; admins: string }[]>`
      SELECT
        COUNT(*) FILTER (WHERE role = 'member')    as members,
        COUNT(*) FILTER (WHERE role = 'moderator') as moderators,
        COUNT(*) FILTER (WHERE role = 'admin')     as admins
      FROM community_members WHERE community_id = ${id} AND status = 'active'
    `;

    return {
      communityId: id,
      members: {
        total:      Number(memberStats?.total ?? 0),
        active:     Number(memberStats?.active ?? 0),
        banned:     Number(memberStats?.banned ?? 0),
        members:    Number(roleStats?.members ?? 0),
        moderators: Number(roleStats?.moderators ?? 0),
        admins:     Number(roleStats?.admins ?? 0),
      },
    };
  });
}
