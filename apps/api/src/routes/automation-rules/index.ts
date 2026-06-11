import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';
import { getAutomationCatalog, getTriggersGrouped, GLOBAL_TRIGGERS, GLOBAL_ACTIONS } from '../../lib/automation-catalog.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const ruleSchema = z.object({
  name:          z.string().min(1),
  triggerType:   z.string().min(1),
  triggerParams: z.record(z.unknown()).optional().default({}),
  actions:       z.array(z.object({
    type:   z.string().min(1),
    params: z.record(z.unknown()).optional().default({}),
  })).min(1),
});

export default async function automationRulesRoutes(app: FastifyInstance) {

  // ── Catalogue ─────────────────────────────────────────────
  app.get('/catalog', hooks, async () => ({
    ...getAutomationCatalog(),
    triggersGrouped: getTriggersGrouped(),
  }));

  // ── Liste des règles ──────────────────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as {
      triggerType?: string;
      actionType?:  string;
      status?:      string;
      search?:      string;
      after?:       string;
      limit?:       string;
    };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    // Filtre sur actionType via containment JSON
    const rows = await sql`
      SELECT r.*,
             COUNT(e.id)                                     as total_runs,
             COUNT(e.id) FILTER (WHERE e.status = 'error')  as error_runs,
             MAX(e.executed_at)                              as last_run_at
      FROM automation_rules r
      LEFT JOIN automation_rule_executions e ON e.rule_id = r.id
      WHERE (${q.status      ?? null} IS NULL OR r.status       = ${q.status      ?? null})
        AND (${q.triggerType ?? null} IS NULL OR r.trigger_type = ${q.triggerType ?? null})
        AND (${q.search      ?? null} IS NULL OR r.name ILIKE ${'%' + (q.search ?? '') + '%'})
        AND (${q.after       ?? null}::uuid IS NULL OR r.id > ${q.after ?? null}::uuid)
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT ${limit}
    `;

    // Filtre actionType côté application (évite JSON path complexe)
    if (q.actionType) {
      return rows.filter((r) =>
        Array.isArray(r.actions) &&
        r.actions.some((a: { type: string }) => a.type === q.actionType),
      );
    }
    return rows;
  });

  // ── Créer une règle ───────────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = ruleSchema.parse(request.body);

    // Valider trigger
    const triggerDef = GLOBAL_TRIGGERS.find((t) => t.type === body.triggerType);
    if (!triggerDef) {
      return reply.status(400).send({ error: 'invalid_trigger', message: `Déclencheur inconnu: ${body.triggerType}` });
    }

    // Valider actions
    for (const action of body.actions) {
      const def = GLOBAL_ACTIONS.find((a) => a.type === action.type);
      if (!def) return reply.status(400).send({ error: 'invalid_action', message: `Action inconnue: ${action.type}` });
      for (const p of def.params) {
        if (p.required && !action.params?.[p.key]) {
          return reply.status(400).send({ error: 'missing_param', message: `Paramètre requis: ${p.key} pour ${action.type}` });
        }
      }
    }

    const [rule] = await sql`
      INSERT INTO automation_rules (name, trigger_type, trigger_params, actions)
      VALUES (
        ${body.name},
        ${body.triggerType},
        ${JSON.stringify(body.triggerParams ?? {})}::jsonb,
        ${JSON.stringify(body.actions)}::jsonb
      )
      RETURNING *
    `;
    return reply.status(201).send(rule);
  });

  // ── Détail d'une règle ────────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [rule] = await sql`SELECT * FROM automation_rules WHERE id = ${id}`;
    if (!rule) return reply.status(404).send({ error: 'not_found' });

    const executions = await sql`
      SELECT e.*, c.email, c.first_name, c.last_name
      FROM automation_rule_executions e
      LEFT JOIN contacts c ON c.id = e.contact_id
      WHERE e.rule_id = ${id}
      ORDER BY e.executed_at DESC
      LIMIT 20
    `;
    // Enrichir avec les labels du catalogue
    const triggerDef = GLOBAL_TRIGGERS.find((t) => t.type === rule.trigger_type);
    return {
      ...rule,
      triggerLabel: triggerDef?.label ?? rule.trigger_type,
      executions,
    };
  });

  // ── Modifier une règle ────────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ruleSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.name          !== undefined) cols.name           = body.name;
    if (body.triggerType   !== undefined) cols.trigger_type   = body.triggerType;
    if (body.triggerParams !== undefined) cols.trigger_params = JSON.stringify(body.triggerParams);
    if (body.actions       !== undefined) cols.actions        = JSON.stringify(body.actions);
    const [updated] = await sql`UPDATE automation_rules SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Activer / mettre en pause ─────────────────────────────
  app.post('/:id/toggle', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [rule] = await sql`
      UPDATE automation_rules
      SET status = CASE WHEN status = 'active' THEN 'paused' ELSE 'active' END,
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, status
    `;
    if (!rule) return reply.status(404).send({ error: 'not_found' });
    return rule;
  });

  // ── Dupliquer ─────────────────────────────────────────────
  app.post('/:id/duplicate', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [original] = await sql`SELECT name, trigger_type, trigger_params, actions FROM automation_rules WHERE id = ${id}`;
    if (!original) return reply.status(404).send({ error: 'not_found' });
    const [copy] = await sql`
      INSERT INTO automation_rules (name, trigger_type, trigger_params, actions, status)
      VALUES (
        ${`${original.name} (copie)`},
        ${original.trigger_type},
        ${JSON.stringify(original.trigger_params)}::jsonb,
        ${JSON.stringify(original.actions)}::jsonb,
        'paused'
      )
      RETURNING *
    `;
    return reply.status(201).send(copy);
  });

  // ── Supprimer ─────────────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM automation_rules WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── Historique d'exécutions ───────────────────────────────
  app.get('/:id/executions', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const q = request.query as { status?: string; limit?: string; after?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT e.*, c.email, c.first_name, c.last_name
      FROM automation_rule_executions e
      LEFT JOIN contacts c ON c.id = e.contact_id
      WHERE e.rule_id = ${id}
        AND (${q.status ?? null} IS NULL OR e.status = ${q.status ?? null})
        AND (${q.after  ?? null}::uuid IS NULL OR e.id > ${q.after ?? null}::uuid)
      ORDER BY e.executed_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Tester manuellement sur un contact ────────────────────
  app.post('/:id/test', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { contactId } = request.body as { contactId: string };
    if (!contactId) return reply.status(400).send({ error: 'contactId_required' });

    const { tenantId } = request.user as { tenantId: string };
    const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;

    const [rule] = await sql<{ trigger_type: string }[]>`
      SELECT trigger_type FROM automation_rules WHERE id = ${id}
    `;
    if (!rule) return reply.status(404).send({ error: 'not_found' });

    const { globalRulesQueue } = await import('../../workers/global-rules.worker.js');
    await globalRulesQueue.add(`test-rule-${id}`, {
      tenantId,
      tenantSchema: schemaName,
      ruleId: id,
      contactId,
      triggerType: rule.trigger_type,
      context: { test: true },
    }, { priority: 1 });

    return { queued: true };
  });

  // ── Statistiques globales ─────────────────────────────────
  app.get('/stats/overview', hooks, async () => {
    return sql`
      SELECT
        COUNT(*)                                     as total,
        COUNT(*) FILTER (WHERE status = 'active')    as active,
        COUNT(*) FILTER (WHERE status = 'paused')    as paused,
        COALESCE(SUM(run_count), 0)                  as total_runs
      FROM automation_rules
    `;
  });
}
