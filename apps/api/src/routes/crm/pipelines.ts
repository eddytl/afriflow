import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const DEFAULT_STAGES = [
  { name: 'Nouveaux leads',         position: 0, color: '#e2e8f0' },
  { name: 'Premier contact établi', position: 1, color: '#bee3f8' },
  { name: 'Proposition envoyée',    position: 2, color: '#fefcbf' },
  { name: 'Négociation',            position: 3, color: '#fbd38d' },
  { name: 'Deal gagné',             position: 4, color: '#c6f6d5' },
];

const pipelineSchema = z.object({
  name:   z.string().min(1),
  stages: z.array(z.object({
    name:     z.string().min(1),
    color:    z.string().optional(),
    position: z.number().optional(),
  })).optional(),
});

const dealSchema = z.object({
  title:             z.string().min(1),
  stageId:           z.string().uuid(),
  contactId:         z.string().uuid().optional(),
  value:             z.number().min(0).optional(),
  currency:          z.string().length(3).optional(),
  notes:             z.string().optional(),
  expectedCloseDate: z.string().optional(),
});

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function pipelineRoutes(app: FastifyInstance) {
  // ── Pipelines ────────────────────────────────────────────
  app.get('/', hooks, async () => {
    // Single query: pipelines + aggregated stages (replaces N+1)
    return sql`
      SELECT
        p.id, p.name, p.created_at,
        COALESCE(json_agg(
          json_build_object(
            'id',          ps.id,
            'name',        ps.name,
            'color',       ps.color,
            'position',    ps.position,
            'deal_count',  ps.deal_count,
            'total_value', ps.total_value
          ) ORDER BY ps.position
        ) FILTER (WHERE ps.id IS NOT NULL), '[]') AS stages
      FROM pipelines p
      LEFT JOIN LATERAL (
        SELECT
          ps2.id, ps2.name, ps2.color, ps2.position,
          COUNT(pd.id)                    AS deal_count,
          COALESCE(SUM(pd.value), 0)      AS total_value
        FROM pipeline_stages ps2
        LEFT JOIN pipeline_deals pd ON pd.stage_id = ps2.id AND pd.status = 'open'
        WHERE ps2.pipeline_id = p.id
        GROUP BY ps2.id
      ) ps ON true
      GROUP BY p.id, p.name, p.created_at
      ORDER BY p.created_at DESC
    `;
  });

  app.post('/', hooks, async (request, reply) => {
    const body = pipelineSchema.parse(request.body);
    const [pipeline] = await sql`INSERT INTO pipelines (name) VALUES (${body.name}) RETURNING *`;

    const stagesToCreate = body.stages ?? DEFAULT_STAGES;
    const stages = [];
    for (const stage of stagesToCreate) {
      const [s] = await sql`
        INSERT INTO pipeline_stages (pipeline_id, name, color, position)
        VALUES (${pipeline.id}, ${stage.name}, ${stage.color ?? '#e2e8f0'}, ${stage.position ?? 0})
        RETURNING *
      `;
      stages.push(s);
    }

    return reply.status(201).send({ ...pipeline, stages });
  });

  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [pipeline] = await sql`SELECT * FROM pipelines WHERE id = ${id}`;
    if (!pipeline) return reply.status(404).send({ error: 'not_found' });

    const stages = await sql`
      SELECT ps.*,
             json_agg(
               json_build_object(
                 'id', pd.id, 'title', pd.title, 'value', pd.value,
                 'currency', pd.currency, 'status', pd.status,
                 'contact_id', pd.contact_id, 'created_at', pd.created_at
               ) ORDER BY pd.created_at
             ) FILTER (WHERE pd.id IS NOT NULL) as deals
      FROM pipeline_stages ps
      LEFT JOIN pipeline_deals pd ON pd.stage_id = ps.id
      WHERE ps.pipeline_id = ${id}
      GROUP BY ps.id
      ORDER BY ps.position
    `;
    return { ...pipeline, stages };
  });

  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name } = request.body as { name: string };
    const [p] = await sql`UPDATE pipelines SET name = ${name} WHERE id = ${id} RETURNING *`;
    if (!p) return reply.status(404).send({ error: 'not_found' });
    return p;
  });

  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM pipelines WHERE id = ${request.params as unknown as string}`;
    return reply.status(204).send();
  });

  // ── Étapes ───────────────────────────────────────────────
  app.post('/:id/stages', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, color } = request.body as { name: string; color?: string };
    const [maxPos] = await sql<{ max: number }[]>`
      SELECT COALESCE(MAX(position), -1) as max FROM pipeline_stages WHERE pipeline_id = ${id}
    `;
    const [stage] = await sql`
      INSERT INTO pipeline_stages (pipeline_id, name, color, position)
      VALUES (${id}, ${name}, ${color ?? '#e2e8f0'}, ${(maxPos?.max ?? -1) + 1})
      RETURNING *
    `;
    return reply.status(201).send(stage);
  });

  app.patch('/:id/stages/:sid', hooks, async (request, reply) => {
    const { sid } = request.params as { id: string; sid: string };
    const body = request.body as { name?: string; color?: string; position?: number };
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined)     updates.name     = body.name;
    if (body.color !== undefined)    updates.color    = body.color;
    if (body.position !== undefined) updates.position = body.position;
    const [stage] = await sql`UPDATE pipeline_stages SET ${sql(updates)} WHERE id = ${sid} RETURNING *`;
    if (!stage) return reply.status(404).send({ error: 'not_found' });
    return stage;
  });

  app.delete('/:id/stages/:sid', hooks, async (request, reply) => {
    const { sid } = request.params as { id: string; sid: string };
    await sql`DELETE FROM pipeline_stages WHERE id = ${sid}`;
    return reply.status(204).send();
  });

  // ── Deals ────────────────────────────────────────────────
  app.post('/:id/deals', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = dealSchema.parse(request.body);
    const [deal] = await sql`
      INSERT INTO pipeline_deals
        (pipeline_id, stage_id, contact_id, title, value, currency, notes, expected_close_date)
      VALUES (
        ${id}, ${body.stageId}, ${body.contactId ?? null}, ${body.title},
        ${body.value ?? 0}, ${body.currency ?? 'XOF'}, ${body.notes ?? null},
        ${body.expectedCloseDate ?? null}
      )
      RETURNING *
    `;
    return reply.status(201).send(deal);
  });

  app.patch('/deals/:did', hooks, async (request, reply) => {
    const { did } = request.params as { did: string };
    const body = dealSchema.partial().parse(request.body);
    const updates: Record<string, unknown> = {};
    if (body.title !== undefined)             updates.title               = body.title;
    if (body.stageId !== undefined)           updates.stage_id            = body.stageId;
    if (body.contactId !== undefined)         updates.contact_id          = body.contactId;
    if (body.value !== undefined)             updates.value               = body.value;
    if (body.currency !== undefined)          updates.currency            = body.currency;
    if (body.notes !== undefined)             updates.notes               = body.notes;
    if (body.expectedCloseDate !== undefined) updates.expected_close_date = body.expectedCloseDate;

    const [deal] = await sql`UPDATE pipeline_deals SET ${sql(updates)} WHERE id = ${did} RETURNING *`;
    if (!deal) return reply.status(404).send({ error: 'not_found' });
    return deal;
  });

  // Changer le statut d'un deal (won / lost / open)
  app.patch('/deals/:did/status', hooks, async (request, reply) => {
    const { did } = request.params as { did: string };
    const { status } = request.body as { status: 'open' | 'won' | 'lost' };
    if (!['open', 'won', 'lost'].includes(status)) {
      return reply.status(400).send({ error: 'invalid_status' });
    }
    const [deal] = await sql`UPDATE pipeline_deals SET status = ${status} WHERE id = ${did} RETURNING *`;
    if (!deal) return reply.status(404).send({ error: 'not_found' });
    return deal;
  });

  app.delete('/deals/:did', hooks, async (request, reply) => {
    await sql`DELETE FROM pipeline_deals WHERE id = ${(request.params as { did: string }).did}`;
    return reply.status(204).send();
  });
}
