import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { emailQueue, smsQueue, whatsappQueue } from '../../lib/queue.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const createCampaignSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['email', 'sms', 'whatsapp']),
  subject: z.string().optional(),
  body: z.string().min(1),
  segmentFilter: z.record(z.unknown()).optional(),
});

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function campaignRoutes(app: FastifyInstance) {
  app.get('/', hooks, async () => {
    return sql`SELECT * FROM campaigns ORDER BY created_at DESC`;
  });

  app.post('/', hooks, async (request, reply) => {
    const body = createCampaignSchema.parse(request.body);
    const [campaign] = await sql`
      INSERT INTO campaigns (name, type, subject, body, segment_filter)
      VALUES (${body.name}, ${body.type}, ${body.subject ?? null},
              ${body.body}, ${JSON.stringify(body.segmentFilter ?? {})}::jsonb)
      RETURNING *
    `;
    return reply.status(201).send(campaign);
  });

  app.post('/:id/send', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = (request.user as { tenantId: string }).tenantId;

    const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${id}`;
    if (!campaign) return reply.status(404).send({ error: 'not_found' });
    if (campaign.status === 'sent') return reply.status(400).send({ error: 'already_sent' });

    await sql`UPDATE campaigns SET status = 'sending' WHERE id = ${id}`;

    const queue = campaign.type === 'email' ? emailQueue
      : campaign.type === 'sms' ? smsQueue
      : whatsappQueue;

    await queue.add('campaign-send', {
      campaignId: id,
      tenantId,
      type: campaign.type,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    return reply.status(202).send({ message: 'Envoi en cours...', campaignId: id });
  });

  app.post('/:id/schedule', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { scheduledAt } = request.body as { scheduledAt: string };
    const date = new Date(scheduledAt);
    if (isNaN(date.getTime()) || date < new Date()) {
      return reply.status(400).send({ error: 'invalid_date', message: 'Date invalide ou passée' });
    }

    const [campaign] = await sql`
      UPDATE campaigns SET status = 'scheduled', scheduled_at = ${date.toISOString()}
      WHERE id = ${id} RETURNING *
    `;
    if (!campaign) return reply.status(404).send({ error: 'not_found' });

    const tenantId = (request.user as { tenantId: string }).tenantId;
    const delay = date.getTime() - Date.now();
    const queue = campaign.type === 'email' ? emailQueue : campaign.type === 'sms' ? smsQueue : whatsappQueue;
    await queue.add('campaign-send', { campaignId: id, tenantId, type: campaign.type }, { delay });

    return campaign;
  });

  app.get('/:id/stats', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [campaign] = await sql`SELECT stats, name, type, status FROM campaigns WHERE id = ${id}`;
    if (!campaign) return reply.status(404).send({ error: 'not_found' });
    return campaign;
  });
}
