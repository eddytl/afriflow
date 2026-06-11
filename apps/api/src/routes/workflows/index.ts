import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

// Types de nœuds du workflow visual builder
const WORKFLOW_NODE_TYPES = [
  // Déclencheurs (identiques aux global triggers)
  'trigger',
  // Actions immédiates
  'send_email', 'send_sms', 'send_whatsapp',
  'add_tag', 'remove_tag',
  'subscribe_campaign', 'unsubscribe_campaign',
  'call_webhook', 'add_to_pipeline_stage',
  'enroll_course', 'revoke_course',
  'grant_community', 'revoke_community',
  // Contrôle de flux
  'wait',           // attendre X temps
  'condition',      // branche si/sinon
  'wait_for_event', // attendre un événement spécifique
  'exit_if',        // quitter si condition
  'delay_until',    // attendre jusqu'à une date
] as const;

const nodeSchema = z.object({
  id:         z.string(),               // identifiant unique du nœud dans le graphe
  type:       z.enum(WORKFLOW_NODE_TYPES),
  label:      z.string().optional(),
  params:     z.record(z.unknown()).default({}),
  nextNode:   z.string().nullable().optional(),   // id du nœud suivant (linéaire)
  trueNode:   z.string().nullable().optional(),   // si condition = true
  falseNode:  z.string().nullable().optional(),   // si condition = false
  position:   z.object({ x: z.number(), y: z.number() }).optional(), // position canvas
});

const workflowSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional(),
  trigger:     z.object({
    type:   z.string(),
    params: z.record(z.unknown()).optional().default({}),
  }),
  nodes:       z.array(nodeSchema).optional().default([]),
  settings:    z.object({
    maxEnrollments:      z.number().int().optional(), // max contacts simultanés
    allowReEnrollment:   z.boolean().optional(),       // réenrôlement autorisé
    reEnrollmentDelayDays: z.number().int().optional(),
  }).optional().default({}),
});

export default async function workflowsRoutes(app: FastifyInstance) {

  // ── Liste des workflows ───────────────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as { status?: string; search?: string; after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    return sql`
      SELECT
        a.id, a.name, a.description, a.status, a.trigger,
        a.share_token, a.settings, a.enrolled_count,
        a.created_at, a.updated_at,
        COUNT(ae.id) FILTER (WHERE ae.status = 'active')    as active_enrollments,
        COUNT(ae.id) FILTER (WHERE ae.status = 'completed') as completed_enrollments,
        COUNT(ae.id)                                         as total_enrollments
      FROM automations a
      LEFT JOIN automation_enrollments ae ON ae.automation_id = a.id
      WHERE (${q.status ?? null} IS NULL OR a.status = ${q.status ?? null})
        AND (${q.search ?? null} IS NULL OR a.name ILIKE ${'%' + (q.search ?? '') + '%'})
        AND (${q.after  ?? null}::uuid IS NULL OR a.id > ${q.after ?? null}::uuid)
      GROUP BY a.id
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Créer un workflow ─────────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = workflowSchema.parse(request.body);
    const [workflow] = await sql`
      INSERT INTO automations (name, description, trigger, steps, settings, status)
      VALUES (
        ${body.name},
        ${body.description ?? null},
        ${JSON.stringify(body.trigger)}::jsonb,
        ${JSON.stringify(body.nodes)}::jsonb,
        ${JSON.stringify(body.settings ?? {})}::jsonb,
        'paused'
      )
      RETURNING *
    `;
    return reply.status(201).send(workflow);
  });

  // ── Détail d'un workflow ──────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [workflow] = await sql`SELECT * FROM automations WHERE id = ${id}`;
    if (!workflow) return reply.status(404).send({ error: 'not_found' });

    const enrollmentStats = await sql<{ status: string; count: string }[]>`
      SELECT status, COUNT(*) as count
      FROM automation_enrollments WHERE automation_id = ${id} GROUP BY status
    `;

    return {
      ...workflow,
      enrollmentStats: Object.fromEntries(enrollmentStats.map((s) => [s.status, Number(s.count)])),
    };
  });

  // ── Modifier le workflow (nœuds + trigger) ────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = workflowSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.name        !== undefined) cols.name        = body.name;
    if (body.description !== undefined) cols.description = body.description;
    if (body.trigger     !== undefined) cols.trigger     = JSON.stringify(body.trigger);
    if (body.nodes       !== undefined) cols.steps       = JSON.stringify(body.nodes);
    if (body.settings    !== undefined) cols.settings    = JSON.stringify(body.settings);
    const [updated] = await sql`UPDATE automations SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer ─────────────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM automations WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── Activer ───────────────────────────────────────────────
  app.post('/:id/activate', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [workflow] = await sql`SELECT trigger, steps FROM automations WHERE id = ${id}`;
    if (!workflow) return reply.status(404).send({ error: 'not_found' });
    if (!workflow.trigger?.type) {
      return reply.status(400).send({ error: 'no_trigger', message: 'Le workflow doit avoir un déclencheur pour être activé' });
    }
    const [updated] = await sql`
      UPDATE automations SET status = 'active', updated_at = now() WHERE id = ${id} RETURNING id, status
    `;
    return updated;
  });

  // ── Mettre en pause ───────────────────────────────────────
  app.post('/:id/pause', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await sql`
      UPDATE automations SET status = 'paused', updated_at = now() WHERE id = ${id} RETURNING id, status
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // Toggle pause ↔ active
  app.post('/:id/toggle', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await sql`
      UPDATE automations
      SET status = CASE WHEN status = 'active' THEN 'paused' ELSE 'active' END,
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, status
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Dupliquer ─────────────────────────────────────────────
  app.post('/:id/duplicate', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [orig] = await sql`SELECT name, description, trigger, steps, settings FROM automations WHERE id = ${id}`;
    if (!orig) return reply.status(404).send({ error: 'not_found' });
    const [copy] = await sql`
      INSERT INTO automations (name, description, trigger, steps, settings, status)
      VALUES (
        ${`${orig.name} (copie)`},
        ${orig.description ?? null},
        ${JSON.stringify(orig.trigger)}::jsonb,
        ${JSON.stringify(orig.steps ?? [])}::jsonb,
        ${JSON.stringify(orig.settings ?? {})}::jsonb,
        'paused'
      )
      RETURNING *
    `;
    return reply.status(201).send(copy);
  });

  // ── Partager — génère un lien de partage public ───────────
  app.post('/:id/share', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Générer un token unique si absent
    const token = randomBytes(16).toString('hex');
    const [workflow] = await sql`
      UPDATE automations
      SET share_token = COALESCE(share_token, ${token}), updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, share_token
    `;
    if (!workflow) return reply.status(404).send({ error: 'not_found' });
    const shareUrl = `${process.env.WEB_URL ?? 'https://app.afriflow.app'}/workflows/import/${workflow.share_token}`;
    return { shareToken: workflow.share_token, shareUrl };
  });

  // Révoquer le lien de partage
  app.delete('/:id/share', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    await sql`UPDATE automations SET share_token = NULL, updated_at = now() WHERE id = ${id}`;
    return reply.status(204).send();
  });

  // ── Importer depuis un lien de partage (public) ───────────
  app.post('/import/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const { tenantId } = request.body as { tenantId: string };
    if (!tenantId) return reply.status(400).send({ error: 'tenantId_required' });

    const [source] = await sql`
      SELECT name, description, trigger, steps, settings
      FROM automations
      WHERE share_token = ${token} LIMIT 1
    `;
    if (!source) return reply.status(404).send({ error: 'workflow_not_found' });

    const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
    await sql.unsafe(`SET search_path = "${schemaName}", public`);

    const [imported] = await sql`
      INSERT INTO automations (name, description, trigger, steps, settings, status)
      VALUES (
        ${`${source.name} (importé)`},
        ${source.description ?? null},
        ${JSON.stringify(source.trigger)}::jsonb,
        ${JSON.stringify(source.steps ?? [])}::jsonb,
        ${JSON.stringify(source.settings ?? {})}::jsonb,
        'paused'
      )
      RETURNING id, name, status
    `;
    return reply.status(201).send(imported);
  });

  // ── Paramètres du workflow ────────────────────────────────
  app.patch('/:id/settings', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { settings } = request.body as { settings: Record<string, unknown> };
    if (!settings || typeof settings !== 'object') {
      return reply.status(400).send({ error: 'invalid_settings' });
    }
    const [updated] = await sql`
      UPDATE automations SET settings = ${JSON.stringify(settings)}::jsonb, updated_at = now()
      WHERE id = ${id} RETURNING *
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Stats et contacts enrôlés ─────────────────────────────
  app.get('/:id/stats', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [workflow] = await sql`SELECT id, name, steps FROM automations WHERE id = ${id}`;
    if (!workflow) return reply.status(404).send({ error: 'not_found' });

    const enrollmentStats = await sql<{ status: string; count: string }[]>`
      SELECT status, COUNT(*) as count
      FROM automation_enrollments WHERE automation_id = ${id} GROUP BY status
    `;
    const stepStats = await sql<{ current_step: number; count: string }[]>`
      SELECT current_step, COUNT(*) as count
      FROM automation_enrollments
      WHERE automation_id = ${id} AND status = 'active'
      GROUP BY current_step ORDER BY current_step
    `;
    const timeSeries = await sql<{ day: string; enrolled: string; completed: string }[]>`
      SELECT
        DATE(created_at) as day,
        COUNT(*) as enrolled,
        COUNT(*) FILTER (WHERE status = 'completed') as completed
      FROM automation_enrollments
      WHERE automation_id = ${id} AND created_at >= now() - interval '30 days'
      GROUP BY DATE(created_at) ORDER BY day
    `;

    return {
      workflowId: id,
      enrollments:  Object.fromEntries(enrollmentStats.map((s) => [s.status, Number(s.count)])),
      activeByStep: stepStats.map((s) => ({ step: s.current_step, count: Number(s.count) })),
      timeSeries:   timeSeries.map((r) => ({
        day:       r.day,
        enrolled:  Number(r.enrolled),
        completed: Number(r.completed),
      })),
    };
  });

  // ── Contacts enrôlés ─────────────────────────────────────
  app.get('/:id/enrollments', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const q = request.query as { status?: string; after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT ae.*, c.email, c.first_name, c.last_name, c.phone
      FROM automation_enrollments ae
      LEFT JOIN contacts c ON c.id = ae.contact_id
      WHERE ae.automation_id = ${id}
        AND (${q.status ?? null} IS NULL OR ae.status = ${q.status ?? null})
        AND (${q.after  ?? null}::uuid IS NULL OR ae.id > ${q.after ?? null}::uuid)
      ORDER BY ae.created_at DESC
      LIMIT ${limit}
    `;
  });

  // Désinscrire un contact d'un workflow
  app.delete('/:id/enrollments/:eid', hooks, async (request, reply) => {
    const { eid } = request.params as { id: string; eid: string };
    await sql`
      UPDATE automation_enrollments SET status = 'exited', context = jsonb_set(context, '{exitReason}', '"manual"')
      WHERE id = ${eid}
    `;
    return reply.status(204).send();
  });
}
