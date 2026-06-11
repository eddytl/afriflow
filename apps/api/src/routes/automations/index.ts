import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const stepSchema = z.object({
  id: z.number(),
  type: z.enum(['send_email', 'send_sms', 'send_whatsapp', 'wait', 'condition', 'add_tag', 'remove_tag', 'wait_for_event', 'exit_if']),
  params: z.record(z.unknown()),
  nextStep: z.number().nullable().optional(),
  trueStep: z.number().nullable().optional(),
  falseStep: z.number().nullable().optional(),
});

const createAutomationSchema = z.object({
  name: z.string().min(1),
  trigger: z.object({
    type: z.enum(['form_submit', 'purchase', 'tag_added', 'event', 'manual']),
    conditions: z.record(z.unknown()).optional(),
  }),
  steps: z.array(stepSchema).optional(),
});

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function automationRoutes(app: FastifyInstance) {
  app.get('/', hooks, async () => {
    return sql`SELECT id, name, status, trigger, created_at FROM automations ORDER BY created_at DESC`;
  });

  app.post('/', hooks, async (request, reply) => {
    const body = createAutomationSchema.parse(request.body);
    const [automation] = await sql`
      INSERT INTO automations (name, trigger, steps)
      VALUES (${body.name}, ${JSON.stringify(body.trigger)}::jsonb, ${JSON.stringify(body.steps ?? [])}::jsonb)
      RETURNING *
    `;
    return reply.status(201).send(automation);
  });

  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = createAutomationSchema.partial().parse(request.body);

    const updates: Record<string, unknown> = {};
    if (body.name) updates.name = body.name;
    if (body.trigger) updates.trigger = JSON.stringify(body.trigger);
    if (body.steps) updates.steps = JSON.stringify(body.steps);

    const [updated] = await sql`UPDATE automations SET ${sql(updates)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  app.post('/:id/toggle', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [automation] = await sql`SELECT status FROM automations WHERE id = ${id}`;
    if (!automation) return reply.status(404).send({ error: 'not_found' });

    const newStatus = automation.status === 'active' ? 'paused' : 'active';
    const [updated] = await sql`UPDATE automations SET status = ${newStatus} WHERE id = ${id} RETURNING *`;
    return updated;
  });

  app.get('/:id/stats', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [automation] = await sql`SELECT id, name, steps FROM automations WHERE id = ${id}`;
    if (!automation) return reply.status(404).send({ error: 'not_found' });

    const enrollmentStats = await sql<{ status: string; count: string }[]>`
      SELECT status, COUNT(*) as count
      FROM automation_enrollments
      WHERE automation_id = ${id}
      GROUP BY status
    `;

    const stepStats = await sql<{ current_step: number; count: string }[]>`
      SELECT current_step, COUNT(*) as count
      FROM automation_enrollments
      WHERE automation_id = ${id} AND status = 'active'
      GROUP BY current_step
      ORDER BY current_step
    `;

    return {
      automationId: id,
      enrollments: Object.fromEntries(enrollmentStats.map((s) => [s.status, Number(s.count)])),
      activeByStep: stepStats.map((s) => ({ step: s.current_step, count: Number(s.count) })),
    };
  });
}
