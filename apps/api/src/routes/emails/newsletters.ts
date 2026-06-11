import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { emailQueue } from '../../lib/queue.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const newsletterSchema = z.object({
  subject:       z.string().min(1),
  fromName:      z.string().min(1),
  fromEmail:     z.string().email(),
  editorType:    z.enum(['visual', 'classic']).default('visual'),
  templateId:    z.string().uuid().optional(),
  bodyHtml:      z.string().optional(),
  bodyText:      z.string().optional(),
  previewText:   z.string().optional(),
  segmentFilter: z.record(z.unknown()).optional().default({}),
});

export default async function newslettersRoutes(app: FastifyInstance) {

  // ── Liste ─────────────────────────────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as { status?: string; search?: string; after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT
        n.*,
        COUNT(e.id) FILTER (WHERE e.event_type = 'sent')        as sent_total,
        COUNT(e.id) FILTER (WHERE e.event_type = 'opened')      as opened_total,
        COUNT(e.id) FILTER (WHERE e.event_type = 'clicked')     as clicked_total,
        COUNT(e.id) FILTER (WHERE e.event_type = 'bounced')     as bounced_total,
        COUNT(e.id) FILTER (WHERE e.event_type = 'unsubscribed') as unsub_total
      FROM newsletters n
      LEFT JOIN email_events e ON e.source_id = n.id AND e.source_type = 'newsletter'
      WHERE (${q.status ?? null} IS NULL OR n.status = ${q.status ?? null})
        AND (${q.search ?? null} IS NULL OR n.subject ILIKE ${'%' + (q.search ?? '') + '%'})
        AND (${q.after  ?? null}::uuid IS NULL OR n.id > ${q.after ?? null}::uuid)
      GROUP BY n.id
      ORDER BY n.created_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Créer ─────────────────────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = newsletterSchema.parse(request.body);
    const [newsletter] = await sql`
      INSERT INTO newsletters (
        subject, from_name, from_email, editor_type, template_id,
        body_html, body_text, preview_text, segment_filter
      ) VALUES (
        ${body.subject}, ${body.fromName}, ${body.fromEmail},
        ${body.editorType}, ${body.templateId ?? null},
        ${body.bodyHtml ?? null}, ${body.bodyText ?? null},
        ${body.previewText ?? null}, ${JSON.stringify(body.segmentFilter)}::jsonb
      )
      RETURNING *
    `;
    return reply.status(201).send(newsletter);
  });

  // ── Détail ────────────────────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [newsletter] = await sql`SELECT * FROM newsletters WHERE id = ${id}`;
    if (!newsletter) return reply.status(404).send({ error: 'not_found' });

    const stats = await sql<{ event_type: string; count: string }[]>`
      SELECT event_type, COUNT(*) as count
      FROM email_events WHERE source_id = ${id} AND source_type = 'newsletter'
      GROUP BY event_type
    `;
    const statMap = Object.fromEntries(stats.map((s) => [s.event_type, Number(s.count)]));
    const sent  = statMap.sent  ?? 0;
    const opened = statMap.opened ?? 0;

    return {
      ...newsletter,
      stats: {
        sent,
        opened,
        clicked:      statMap.clicked      ?? 0,
        bounced:      statMap.bounced       ?? 0,
        spam:         statMap.spam          ?? 0,
        unsubscribed: statMap.unsubscribed  ?? 0,
        openRate:     sent  > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
        clickRate:    sent  > 0 ? Math.round(((statMap.clicked ?? 0) / sent) * 1000) / 10 : 0,
        bounceRate:   sent  > 0 ? Math.round(((statMap.bounced ?? 0) / sent) * 1000) / 10 : 0,
        spamRate:     opened > 0 ? Math.round(((statMap.spam ?? 0) / opened) * 1000) / 10 : 0,
      },
    };
  });

  // ── Modifier (brouillon seulement) ────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [existing] = await sql`SELECT status FROM newsletters WHERE id = ${id}`;
    if (!existing) return reply.status(404).send({ error: 'not_found' });
    if (existing.status === 'sent') {
      return reply.status(400).send({ error: 'already_sent', message: 'Impossible de modifier une newsletter déjà envoyée' });
    }
    const body = newsletterSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.subject       !== undefined) cols.subject        = body.subject;
    if (body.fromName      !== undefined) cols.from_name      = body.fromName;
    if (body.fromEmail     !== undefined) cols.from_email     = body.fromEmail;
    if (body.editorType    !== undefined) cols.editor_type    = body.editorType;
    if (body.templateId    !== undefined) cols.template_id    = body.templateId;
    if (body.bodyHtml      !== undefined) cols.body_html      = body.bodyHtml;
    if (body.bodyText      !== undefined) cols.body_text      = body.bodyText;
    if (body.previewText   !== undefined) cols.preview_text   = body.previewText;
    if (body.segmentFilter !== undefined) cols.segment_filter = JSON.stringify(body.segmentFilter);
    const [updated] = await sql`UPDATE newsletters SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    return updated;
  });

  // ── Envoyer maintenant ────────────────────────────────────
  app.post('/:id/send', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const [newsletter] = await sql`SELECT * FROM newsletters WHERE id = ${id}`;
    if (!newsletter) return reply.status(404).send({ error: 'not_found' });
    if (newsletter.status === 'sent') return reply.status(400).send({ error: 'already_sent' });
    if (!newsletter.body_html && !newsletter.body_text) {
      return reply.status(400).send({ error: 'no_body', message: 'Le corps de la newsletter est vide' });
    }
    await sql`UPDATE newsletters SET status = 'sending', updated_at = now() WHERE id = ${id}`;
    await emailQueue.add('newsletter-send', {
      newsletterId: id, tenantId, type: 'newsletter',
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    return reply.status(202).send({ message: 'Envoi en cours...', newsletterId: id });
  });

  // ── Planifier ─────────────────────────────────────────────
  app.post('/:id/schedule', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { scheduledAt } = request.body as { scheduledAt: string };
    const date = new Date(scheduledAt);
    if (isNaN(date.getTime()) || date < new Date()) {
      return reply.status(400).send({ error: 'invalid_date', message: 'Date invalide ou passée' });
    }
    const [updated] = await sql`
      UPDATE newsletters SET status = 'scheduled', scheduled_at = ${date.toISOString()}, updated_at = now()
      WHERE id = ${id} AND status IN ('draft', 'scheduled')
      RETURNING *
    `;
    if (!updated) return reply.status(400).send({ error: 'not_schedulable' });
    const delay = date.getTime() - Date.now();
    await emailQueue.add('newsletter-send', { newsletterId: id, tenantId, type: 'newsletter' }, { delay });
    return updated;
  });

  // ── Annuler la planification ──────────────────────────────
  app.post('/:id/unschedule', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await sql`
      UPDATE newsletters SET status = 'draft', scheduled_at = NULL, updated_at = now()
      WHERE id = ${id} AND status = 'scheduled' RETURNING id, status
    `;
    if (!updated) return reply.status(400).send({ error: 'not_scheduled' });
    return updated;
  });

  // ── Dupliquer ─────────────────────────────────────────────
  app.post('/:id/duplicate', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [orig] = await sql`SELECT * FROM newsletters WHERE id = ${id}`;
    if (!orig) return reply.status(404).send({ error: 'not_found' });
    const [copy] = await sql`
      INSERT INTO newsletters (
        subject, from_name, from_email, editor_type, template_id,
        body_html, body_text, preview_text, segment_filter
      ) VALUES (
        ${'[Copie] ' + orig.subject}, ${orig.from_name}, ${orig.from_email},
        ${orig.editor_type}, ${orig.template_id ?? null},
        ${orig.body_html ?? null}, ${orig.body_text ?? null},
        ${orig.preview_text ?? null}, ${JSON.stringify(orig.segment_filter)}::jsonb
      )
      RETURNING *
    `;
    return reply.status(201).send(copy);
  });

  // ── Supprimer ─────────────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [nw] = await sql`SELECT status FROM newsletters WHERE id = ${id}`;
    if (!nw) return reply.status(404).send({ error: 'not_found' });
    if (nw.status === 'sending') {
      return reply.status(400).send({ error: 'sending_in_progress' });
    }
    await sql`DELETE FROM newsletters WHERE id = ${id}`;
    return reply.status(204).send();
  });

  // ── Statistiques détaillées d'une newsletter ──────────────
  app.get('/:id/stats', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [newsletter] = await sql`SELECT id, subject, sent_count FROM newsletters WHERE id = ${id}`;
    if (!newsletter) return reply.status(404).send({ error: 'not_found' });

    const events = await sql<{ event_type: string; count: string }[]>`
      SELECT event_type, COUNT(*) as count FROM email_events
      WHERE source_id = ${id} AND source_type = 'newsletter'
      GROUP BY event_type
    `;
    const m = Object.fromEntries(events.map((e) => [e.event_type, Number(e.count)]));
    const sent   = m.sent   ?? 0;
    const opened = m.opened ?? 0;

    const topLinks = await sql<{ url: string; clicks: string }[]>`
      SELECT metadata->>'url' as url, COUNT(*) as clicks
      FROM email_events
      WHERE source_id = ${id} AND source_type = 'newsletter' AND event_type = 'clicked'
      GROUP BY metadata->>'url' ORDER BY clicks DESC LIMIT 10
    `;

    return {
      newsletterId: id,
      subject: newsletter.subject,
      sent, opened,
      clicked:      m.clicked ?? 0,
      bounced:      m.bounced ?? 0,
      spam:         m.spam    ?? 0,
      unsubscribed: m.unsubscribed ?? 0,
      openRate:   sent  > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
      clickRate:  sent  > 0 ? Math.round(((m.clicked ?? 0) / sent) * 1000) / 10 : 0,
      bounceRate: sent  > 0 ? Math.round(((m.bounced ?? 0) / sent) * 1000) / 10 : 0,
      spamRate:   opened > 0 ? Math.round(((m.spam ?? 0) / opened) * 1000) / 10 : 0,
      topLinks:   topLinks.map((l) => ({ url: l.url, clicks: Number(l.clicks) })),
    };
  });

  // ── Templates disponibles ─────────────────────────────────
  app.get('/templates', hooks, async () => {
    return sql`SELECT id, name, thumbnail FROM email_templates ORDER BY is_system DESC, name ASC`;
  });

  // ── Prévisualisation du corps de l'email ──────────────────
  app.post('/:id/preview', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { contactId } = request.body as { contactId?: string };
    const [newsletter] = await sql`SELECT subject, body_html, body_text FROM newsletters WHERE id = ${id}`;
    if (!newsletter) return reply.status(404).send({ error: 'not_found' });

    let contact: Record<string, string | null> = {};
    if (contactId) {
      const [c] = await sql`SELECT first_name, last_name, email FROM contacts WHERE id = ${contactId}`;
      if (c) contact = c;
    }
    // Interpolation simple
    const interpolate = (t: string) =>
      t.replace(/\{\{first_name\}\}/g, contact.first_name ?? 'Prénom')
       .replace(/\{\{last_name\}\}/g,  contact.last_name  ?? 'Nom')
       .replace(/\{\{email\}\}/g,       contact.email      ?? 'email@exemple.com');

    return {
      subject:  interpolate(newsletter.subject),
      bodyHtml: newsletter.body_html ? interpolate(newsletter.body_html) : null,
      bodyText: newsletter.body_text ? interpolate(newsletter.body_text) : null,
    };
  });
}
