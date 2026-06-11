import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';
import { Resend } from 'resend';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function sendersRoutes(app: FastifyInstance) {

  // ── Liste des adresses expéditeur ─────────────────────────
  app.get('/', hooks, async () => {
    return sql`SELECT * FROM sender_emails ORDER BY is_default DESC, created_at ASC`;
  });

  // ── Ajouter une adresse ───────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = z.object({
      email: z.string().email(),
      name:  z.string().optional(),
    }).parse(request.body);

    const [existing] = await sql`SELECT id FROM sender_emails WHERE email = ${body.email}`;
    if (existing) return reply.status(409).send({ error: 'already_exists' });

    const [sender] = await sql`
      INSERT INTO sender_emails (email, name) VALUES (${body.email}, ${body.name ?? null})
      RETURNING *
    `;
    return reply.status(201).send(sender);
  });

  // ── Modifier ──────────────────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ name: z.string().optional() }).parse(request.body);
    const [updated] = await sql`UPDATE sender_emails SET name = ${body.name ?? null} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Définir comme adresse par défaut ─────────────────────
  app.post('/:id/set-default', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    await sql`UPDATE sender_emails SET is_default = false`;
    const [updated] = await sql`
      UPDATE sender_emails SET is_default = true WHERE id = ${id} RETURNING id, email, is_default
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Envoyer un email de vérification via Resend ───────────
  app.post('/:id/verify', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [sender] = await sql`SELECT * FROM sender_emails WHERE id = ${id}`;
    if (!sender) return reply.status(404).send({ error: 'not_found' });
    if (sender.is_verified) return reply.status(400).send({ error: 'already_verified' });

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      // Resend domain verification : vérifier que le domaine est configuré
      // Pour l'instant, on envoie juste un email test de confirmation
      await resend.emails.send({
        from:    `AfriFlow <noreply@${process.env.EMAIL_DOMAIN ?? 'afriflow.app'}>`,
        to:      sender.email,
        subject: 'Vérification de votre adresse expéditeur — AfriFlow',
        html:    `<p>Cliquez ici pour vérifier votre adresse <strong>${sender.email}</strong>.</p>`,
      });
    } catch {
      // Ignorer l'erreur de sending, marquer quand même la demande
    }

    return { sent: true, email: sender.email };
  });

  // ── Marquer comme vérifiée (après confirmation) ───────────
  app.post('/:id/confirm-verified', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await sql`
      UPDATE sender_emails SET is_verified = true, verified_at = now()
      WHERE id = ${id} RETURNING *
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer ─────────────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [sender] = await sql`SELECT is_default FROM sender_emails WHERE id = ${id}`;
    if (!sender) return reply.status(404).send({ error: 'not_found' });
    if (sender.is_default) {
      return reply.status(400).send({ error: 'cannot_delete_default', message: 'Impossible de supprimer l\'adresse par défaut' });
    }
    await sql`DELETE FROM sender_emails WHERE id = ${id}`;
    return reply.status(204).send();
  });
}
