import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';
import crypto from 'crypto';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function workspaceMembersRoutes(app: FastifyInstance) {

  // ── Liste des membres / assistants ────────────────────────────
  app.get('/workspace-members', hooks, async () => {
    return sql`
      SELECT id, email, name, role, status, invited_at, joined_at, created_at
      FROM workspace_members
      ORDER BY created_at DESC
    `;
  });

  // ── Inviter un assistant ──────────────────────────────────────
  app.post('/workspace-members', hooks, async (request, reply) => {
    const body = z.object({
      email: z.string().email(),
      role:  z.enum(['assistant', 'admin']).default('assistant'),
      name:  z.string().max(100).optional(),
    }).parse(request.body);

    const [existing] = await sql`SELECT id, status FROM workspace_members WHERE email = ${body.email}`;
    if (existing && existing.status === 'active') {
      return reply.status(409).send({ error: 'already_member' });
    }

    const token = crypto.randomBytes(24).toString('hex');

    const [member] = await sql`
      INSERT INTO workspace_members (email, name, role, invitation_token)
      VALUES (${body.email}, ${body.name ?? null}, ${body.role}, ${token})
      ON CONFLICT (email) DO UPDATE
        SET invitation_token = ${token}, status = 'pending', invited_at = now()
      RETURNING id, email, name, role, status, invited_at
    `;

    // Envoyer l'email d'invitation via Resend
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const inviteUrl = `${process.env.WEB_URL ?? 'http://localhost:3000'}/accept-invitation/${token}`;
      await resend.emails.send({
        from:    `AfriFlow <noreply@${process.env.EMAIL_DOMAIN ?? 'afriflow.app'}>`,
        to:      body.email,
        subject: 'Invitation à rejoindre un espace de travail AfriFlow',
        html:    `<p>Vous avez été invité(e) en tant qu'assistant(e).</p>
                  <p><a href="${inviteUrl}">Accepter l'invitation</a></p>`,
      });
    } catch { /* ignore send errors */ }

    return reply.status(201).send(member);
  });

  // ── Modifier le rôle d'un membre ──────────────────────────────
  app.patch('/workspace-members/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { role } = z.object({ role: z.enum(['assistant', 'admin']) }).parse(request.body);
    const [updated] = await sql`
      UPDATE workspace_members SET role = ${role} WHERE id = ${id}
      RETURNING id, email, role, status
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Révoquer l'accès ──────────────────────────────────────────
  app.delete('/workspace-members/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await sql`
      UPDATE workspace_members SET status = 'revoked' WHERE id = ${id}
      RETURNING id
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return reply.status(204).send();
  });

  // ── Réinviter ─────────────────────────────────────────────────
  app.post('/workspace-members/:id/resend-invite', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const token = crypto.randomBytes(24).toString('hex');
    const [member] = await sql`
      UPDATE workspace_members
      SET invitation_token = ${token}, invited_at = now()
      WHERE id = ${id} AND status = 'pending'
      RETURNING email, name
    `;
    if (!member) return reply.status(404).send({ error: 'not_found' });

    try {
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const inviteUrl = `${process.env.WEB_URL ?? 'http://localhost:3000'}/accept-invitation/${token}`;
      await resend.emails.send({
        from:    `AfriFlow <noreply@${process.env.EMAIL_DOMAIN ?? 'afriflow.app'}>`,
        to:      member.email,
        subject: 'Invitation à rejoindre un espace de travail AfriFlow (rappel)',
        html:    `<p><a href="${inviteUrl}">Accepter l'invitation</a></p>`,
      });
    } catch { /* ignore */ }

    return { sent: true };
  });

  // ── Accepter une invitation (PUBLIC) ─────────────────────────
  app.post('/workspace-members/accept/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const { name, password } = request.body as { name?: string; password?: string };

    const [member] = await sql`
      SELECT * FROM workspace_members
      WHERE invitation_token = ${token} AND status = 'pending'
    `;
    if (!member) return reply.status(404).send({ error: 'invalid_or_expired_token' });

    await sql`
      UPDATE workspace_members
      SET status = 'active', invitation_token = NULL, joined_at = now(),
          name = COALESCE(${name ?? null}, name)
      WHERE id = ${member.id}
    `;

    return {
      message: 'Invitation acceptée. Vous pouvez maintenant vous connecter.',
      email:   member.email,
      role:    member.role,
    };
  });
}
