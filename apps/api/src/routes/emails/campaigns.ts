import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { emailQueue } from '../../lib/queue.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const campaignSchema = z.object({
  name:        z.string().min(1),
  fromEmail:   z.string().email(),
  fromName:    z.string().optional(),
  description: z.string().optional(),
  editorType:  z.enum(['visual', 'classic']).default('visual'),
  segmentFilter: z.record(z.unknown()).optional().default({}),
});

const stepSchema = z.object({
  subject:     z.string().min(1),
  fromName:    z.string().optional(),
  bodyHtml:    z.string().optional(),
  bodyText:    z.string().optional(),
  previewText: z.string().optional(),
  delayDays:   z.number().int().min(0).default(0),
  delayHours:  z.number().int().min(0).max(23).default(0),
  stepNumber:  z.number().int().min(1).optional(),
});

export default async function emailCampaignsRoutes(app: FastifyInstance) {

  // ── Liste ─────────────────────────────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as { search?: string; status?: string; after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT c.*,
             COUNT(DISTINCT cs.id)                                as step_count,
             COALESCE(SUM(cs.sent_count), 0)                     as total_sent,
             (SELECT COUNT(DISTINCT ae.contact_id)
              FROM automation_enrollments ae WHERE ae.automation_id IS NULL
              -- placeholder: will be replaced with campaign contacts
             ) as subscriber_count
      FROM campaigns c
      LEFT JOIN campaign_steps cs ON cs.campaign_id = c.id
      WHERE c.type = 'email'
        AND (${q.status ?? null} IS NULL OR c.status = ${q.status ?? null})
        AND (${q.search ?? null} IS NULL OR c.name ILIKE ${'%' + (q.search ?? '') + '%'})
        AND (${q.after  ?? null}::uuid IS NULL OR c.id > ${q.after ?? null}::uuid)
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Créer une campagne email ──────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = campaignSchema.parse(request.body);
    const [campaign] = await sql`
      INSERT INTO campaigns (name, type, from_email, from_name, description, editor_type, segment_filter, body)
      VALUES (
        ${body.name}, 'email', ${body.fromEmail},
        ${body.fromName ?? null}, ${body.description ?? null},
        ${body.editorType},
        ${JSON.stringify(body.segmentFilter)}::jsonb,
        ''
      )
      RETURNING *
    `;
    return reply.status(201).send(campaign);
  });

  // ── Détail d'une campagne ─────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${id} AND type = 'email'`;
    if (!campaign) return reply.status(404).send({ error: 'not_found' });

    const steps = await sql`
      SELECT cs.*,
             COUNT(e.id) FILTER (WHERE e.event_type = 'sent')    as sent_total,
             COUNT(e.id) FILTER (WHERE e.event_type = 'opened')  as opened_total,
             COUNT(e.id) FILTER (WHERE e.event_type = 'clicked') as clicked_total
      FROM campaign_steps cs
      LEFT JOIN email_events e ON e.source_id = cs.id AND e.source_type = 'campaign_step'
      WHERE cs.campaign_id = ${id}
      GROUP BY cs.id
      ORDER BY cs.step_number
    `;

    return { ...campaign, steps };
  });

  // ── Modifier une campagne ─────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = campaignSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.name          !== undefined) cols.name           = body.name;
    if (body.fromEmail     !== undefined) cols.from_email     = body.fromEmail;
    if (body.fromName      !== undefined) cols.from_name      = body.fromName;
    if (body.description   !== undefined) cols.description    = body.description;
    if (body.editorType    !== undefined) cols.editor_type    = body.editorType;
    if (body.segmentFilter !== undefined) cols.segment_filter = JSON.stringify(body.segmentFilter);
    const [updated] = await sql`UPDATE campaigns SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer ─────────────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM campaigns WHERE id = ${(request.params as { id: string }).id} AND type = 'email'`;
    return reply.status(204).send();
  });

  // ─────────────── ÉTAPES ────────────────────────────────────

  // ── Liste des étapes ──────────────────────────────────────
  app.get('/:id/steps', hooks, async (request) => {
    const { id } = request.params as { id: string };
    return sql`SELECT * FROM campaign_steps WHERE campaign_id = ${id} ORDER BY step_number`;
  });

  // ── Ajouter une étape ─────────────────────────────────────
  app.post('/:id/steps', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = stepSchema.parse(request.body);

    // Déterminer le numéro d'étape si non fourni
    let stepNumber = body.stepNumber;
    if (!stepNumber) {
      const [last] = await sql<{ max: number | null }[]>`
        SELECT MAX(step_number) as max FROM campaign_steps WHERE campaign_id = ${id}
      `;
      stepNumber = (last?.max ?? 0) + 1;
    }

    const [step] = await sql`
      INSERT INTO campaign_steps (
        campaign_id, step_number, subject, from_name,
        body_html, body_text, preview_text, delay_days, delay_hours
      ) VALUES (
        ${id}, ${stepNumber}, ${body.subject}, ${body.fromName ?? null},
        ${body.bodyHtml ?? null}, ${body.bodyText ?? null},
        ${body.previewText ?? null}, ${body.delayDays}, ${body.delayHours}
      )
      RETURNING *
    `;
    return reply.status(201).send(step);
  });

  // ── Modifier une étape ────────────────────────────────────
  app.patch('/:id/steps/:stepId', hooks, async (request, reply) => {
    const { stepId } = request.params as { id: string; stepId: string };
    const body = stepSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.subject     !== undefined) cols.subject      = body.subject;
    if (body.fromName    !== undefined) cols.from_name    = body.fromName;
    if (body.bodyHtml    !== undefined) cols.body_html    = body.bodyHtml;
    if (body.bodyText    !== undefined) cols.body_text    = body.bodyText;
    if (body.previewText !== undefined) cols.preview_text = body.previewText;
    if (body.delayDays   !== undefined) cols.delay_days   = body.delayDays;
    if (body.delayHours  !== undefined) cols.delay_hours  = body.delayHours;
    const [updated] = await sql`UPDATE campaign_steps SET ${sql(cols)} WHERE id = ${stepId} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Réordonner les étapes ─────────────────────────────────
  app.post('/:id/steps/reorder', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const { order } = request.body as { order: string[] };  // tableau d'ids dans le nouvel ordre
    for (let i = 0; i < order.length; i++) {
      await sql`
        UPDATE campaign_steps SET step_number = ${i + 1}
        WHERE id = ${order[i]} AND campaign_id = ${id}
      `;
    }
    return sql`SELECT * FROM campaign_steps WHERE campaign_id = ${id} ORDER BY step_number`;
  });

  // ── Supprimer une étape ───────────────────────────────────
  app.delete('/:id/steps/:stepId', hooks, async (request, reply) => {
    await sql`DELETE FROM campaign_steps WHERE id = ${(request.params as { id: string; stepId: string }).stepId}`;
    return reply.status(204).send();
  });

  // ── Toggle statut d'une étape ─────────────────────────────
  app.post('/:id/steps/:stepId/toggle', hooks, async (request, reply) => {
    const { stepId } = request.params as { id: string; stepId: string };
    const [updated] = await sql`
      UPDATE campaign_steps
      SET status = CASE WHEN status = 'active' THEN 'paused' ELSE 'active' END, updated_at = now()
      WHERE id = ${stepId}
      RETURNING id, status
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Statistiques d'une campagne ───────────────────────────
  app.get('/:id/stats', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [campaign] = await sql`SELECT id, name FROM campaigns WHERE id = ${id}`;
    if (!campaign) return reply.status(404).send({ error: 'not_found' });

    const stepStats = await sql<{
      step_id: string; step_number: number; subject: string;
      sent: string; opened: string; clicked: string; bounced: string; spam: string;
    }[]>`
      SELECT cs.id as step_id, cs.step_number, cs.subject,
        COUNT(e.id) FILTER (WHERE e.event_type = 'sent')    as sent,
        COUNT(e.id) FILTER (WHERE e.event_type = 'opened')  as opened,
        COUNT(e.id) FILTER (WHERE e.event_type = 'clicked') as clicked,
        COUNT(e.id) FILTER (WHERE e.event_type = 'bounced') as bounced,
        COUNT(e.id) FILTER (WHERE e.event_type = 'spam')    as spam
      FROM campaign_steps cs
      LEFT JOIN email_events e ON e.source_id = cs.id AND e.source_type = 'campaign_step'
      WHERE cs.campaign_id = ${id}
      GROUP BY cs.id ORDER BY cs.step_number
    `;

    return {
      campaignId: id,
      steps: stepStats.map((s) => {
        const sent   = Number(s.sent);
        const opened = Number(s.opened);
        return {
          stepId:     s.step_id,
          stepNumber: s.step_number,
          subject:    s.subject,
          sent, opened,
          clicked:    Number(s.clicked),
          bounced:    Number(s.bounced),
          spam:       Number(s.spam),
          openRate:   sent  > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
          clickRate:  sent  > 0 ? Math.round((Number(s.clicked) / sent) * 1000) / 10 : 0,
          spamRate:   opened > 0 ? Math.round((Number(s.spam) / opened) * 1000) / 10 : 0,
        };
      }),
    };
  });

  // ── Envoyer la campagne (démarrer la séquence) ────────────
  app.post('/:id/start', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${id}`;
    if (!campaign) return reply.status(404).send({ error: 'not_found' });
    if (campaign.status === 'sent') return reply.status(400).send({ error: 'already_sent' });
    const steps = await sql`SELECT id FROM campaign_steps WHERE campaign_id = ${id} LIMIT 1`;
    if (steps.length === 0) {
      return reply.status(400).send({ error: 'no_steps', message: 'Ajoutez au moins une étape avant de lancer la campagne' });
    }
    await sql`UPDATE campaigns SET status = 'active', updated_at = now() WHERE id = ${id}`;
    await emailQueue.add('campaign-start', { campaignId: id, tenantId }, {
      attempts: 3, backoff: { type: 'exponential', delay: 5000 },
    });
    return reply.status(202).send({ message: 'Campagne démarrée', campaignId: id });
  });

  // ── Pause / Reprendre ─────────────────────────────────────
  app.post('/:id/toggle', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await sql`
      UPDATE campaigns
      SET status = CASE WHEN status = 'active' THEN 'paused' ELSE 'active' END, updated_at = now()
      WHERE id = ${id} RETURNING id, name, status
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });
}
