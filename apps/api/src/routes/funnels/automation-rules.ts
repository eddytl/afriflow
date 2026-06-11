import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';
import { getCatalog, validateTrigger, validateAction } from '../../lib/funnel-rules-catalog.js';
import { fireFunnelRules, funnelRulesQueue } from '../../workers/funnel-rules.worker.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const triggerSchema = z.object({
  type:   z.string().min(1),
  params: z.record(z.unknown()).optional().default({}),
});

const actionSchema = z.object({
  type:   z.string().min(1),
  params: z.record(z.unknown()).optional().default({}),
});

const ruleSchema = z.object({
  name:    z.string().optional(),
  trigger: triggerSchema,
  actions: z.array(actionSchema).min(1),
});

export default async function funnelAutomationRulesRoutes(app: FastifyInstance) {

  // ── Catalogue des déclencheurs et actions disponibles ─────
  app.get('/catalog', hooks, async () => getCatalog());

  // ── Règles d'une étape ────────────────────────────────────
  app.get('/:funnelId/pages/:pageId/automation-rules', hooks, async (request) => {
    const { pageId } = request.params as { funnelId: string; pageId: string };
    return sql`
      SELECT r.*,
             COUNT(e.id)                                       as total_runs,
             COUNT(e.id) FILTER (WHERE e.status = 'error')    as error_runs,
             MAX(e.executed_at)                                as last_run_at
      FROM funnel_automation_rules r
      LEFT JOIN funnel_rule_executions e ON e.rule_id = r.id
      WHERE r.page_id = ${pageId}
      GROUP BY r.id
      ORDER BY r.created_at
    `;
  });

  // ── Créer une règle ───────────────────────────────────────
  app.post('/:funnelId/pages/:pageId/automation-rules', hooks, async (request, reply) => {
    const { funnelId, pageId } = request.params as { funnelId: string; pageId: string };
    const body = ruleSchema.parse(request.body);

    // Valider le déclencheur
    const triggerError = validateTrigger(body.trigger.type, body.trigger.params ?? {});
    if (triggerError) return reply.status(400).send({ error: 'invalid_trigger', message: triggerError });

    // Valider chaque action
    for (const action of body.actions) {
      const actionError = validateAction(action.type, action.params ?? {});
      if (actionError) return reply.status(400).send({ error: 'invalid_action', message: actionError });
    }

    const [rule] = await sql`
      INSERT INTO funnel_automation_rules (funnel_id, page_id, name, trigger, actions)
      VALUES (
        ${funnelId},
        ${pageId},
        ${body.name ?? null},
        ${JSON.stringify(body.trigger)}::jsonb,
        ${JSON.stringify(body.actions)}::jsonb
      )
      RETURNING *
    `;
    return reply.status(201).send(rule);
  });

  // ── Détail d'une règle ────────────────────────────────────
  app.get('/:funnelId/pages/:pageId/automation-rules/:ruleId', hooks, async (request, reply) => {
    const { ruleId } = request.params as { funnelId: string; pageId: string; ruleId: string };
    const [rule] = await sql`SELECT * FROM funnel_automation_rules WHERE id = ${ruleId}`;
    if (!rule) return reply.status(404).send({ error: 'not_found' });
    const executions = await sql`
      SELECT * FROM funnel_rule_executions WHERE rule_id = ${ruleId} ORDER BY executed_at DESC LIMIT 20
    `;
    return { ...rule, executions };
  });

  // ── Modifier une règle ────────────────────────────────────
  app.patch('/:funnelId/pages/:pageId/automation-rules/:ruleId', hooks, async (request, reply) => {
    const { ruleId } = request.params as { funnelId: string; pageId: string; ruleId: string };
    const body = ruleSchema.partial().parse(request.body);

    const cols: Record<string, unknown> = { updated_at: new Date() };

    if (body.name !== undefined) cols.name = body.name;

    if (body.trigger) {
      const err = validateTrigger(body.trigger.type, body.trigger.params ?? {});
      if (err) return reply.status(400).send({ error: 'invalid_trigger', message: err });
      cols.trigger = JSON.stringify(body.trigger);
    }

    if (body.actions) {
      for (const action of body.actions) {
        const err = validateAction(action.type, action.params ?? {});
        if (err) return reply.status(400).send({ error: 'invalid_action', message: err });
      }
      cols.actions = JSON.stringify(body.actions);
    }

    const [updated] = await sql`UPDATE funnel_automation_rules SET ${sql(cols)} WHERE id = ${ruleId} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Activer / désactiver une règle ────────────────────────
  app.post('/:funnelId/pages/:pageId/automation-rules/:ruleId/toggle', hooks, async (request, reply) => {
    const { ruleId } = request.params as { funnelId: string; pageId: string; ruleId: string };
    const [rule] = await sql`
      UPDATE funnel_automation_rules
      SET is_active = NOT is_active, updated_at = now()
      WHERE id = ${ruleId}
      RETURNING id, is_active
    `;
    if (!rule) return reply.status(404).send({ error: 'not_found' });
    return { id: rule.id, isActive: rule.is_active };
  });

  // ── Supprimer une règle ───────────────────────────────────
  app.delete('/:funnelId/pages/:pageId/automation-rules/:ruleId', hooks, async (request, reply) => {
    await sql`DELETE FROM funnel_automation_rules WHERE id = ${(request.params as { ruleId: string }).ruleId}`;
    return reply.status(204).send();
  });

  // ── Dupliquer une règle ───────────────────────────────────
  app.post('/:funnelId/pages/:pageId/automation-rules/:ruleId/duplicate', hooks, async (request, reply) => {
    const { funnelId, pageId, ruleId } = request.params as {
      funnelId: string; pageId: string; ruleId: string;
    };
    const [original] = await sql<{
      name: string | null; trigger: unknown; actions: unknown;
    }[]>`SELECT name, trigger, actions FROM funnel_automation_rules WHERE id = ${ruleId}`;
    if (!original) return reply.status(404).send({ error: 'not_found' });

    const [copy] = await sql`
      INSERT INTO funnel_automation_rules (funnel_id, page_id, name, trigger, actions)
      VALUES (
        ${funnelId}, ${pageId},
        ${original.name ? `${original.name} (copie)` : null},
        ${JSON.stringify(original.trigger)}::jsonb,
        ${JSON.stringify(original.actions)}::jsonb
      )
      RETURNING *
    `;
    return reply.status(201).send(copy);
  });

  // ── Historique d'exécutions d'une règle ───────────────────
  app.get('/:funnelId/pages/:pageId/automation-rules/:ruleId/executions', hooks, async (request) => {
    const { ruleId } = request.params as { funnelId: string; pageId: string; ruleId: string };
    const q = request.query as { status?: string; limit?: string; after?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT e.*, c.email, c.first_name, c.last_name
      FROM funnel_rule_executions e
      LEFT JOIN contacts c ON c.id = e.contact_id
      WHERE e.rule_id = ${ruleId}
        AND (${q.status ?? null} IS NULL OR e.status = ${q.status ?? null})
        AND (${q.after ?? null}::uuid IS NULL OR e.id > ${q.after ?? null}::uuid)
      ORDER BY e.executed_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Déclencher manuellement (test) ───────────────────────
  app.post('/:funnelId/pages/:pageId/automation-rules/:ruleId/test', hooks, async (request, reply) => {
    const { pageId, ruleId } = request.params as {
      funnelId: string; pageId: string; ruleId: string;
    };
    const { contactId } = request.body as { contactId: string };
    if (!contactId) return reply.status(400).send({ error: 'contactId_required' });

    const { tenantId } = request.user as { tenantId: string };
    const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;

    // Vérifier que la règle existe
    const [rule] = await sql<{ trigger: { type: string } }[]>`
      SELECT trigger FROM funnel_automation_rules WHERE id = ${ruleId}
    `;
    if (!rule) return reply.status(404).send({ error: 'not_found' });

    // Exécuter directement via la queue (priorité maximale)
    await funnelRulesQueue.add(
      `test-${ruleId}`,
      {
        tenantId,
        tenantSchema: schemaName,
        ruleId,
        contactId,
        triggerType: rule.trigger.type,
        context: { test: true },
      },
      { priority: 1 },
    );

    return { queued: true, message: 'Règle envoyée en exécution de test' };
  });

  // ── Endpoint public : recevoir un événement de tunnel ─────
  // Appelé depuis le frontend (page publique) quand un visiteur remplit un formulaire
  app.post('/:funnelId/pages/:pageId/trigger', async (request, reply) => {
    const { funnelId, pageId } = request.params as { funnelId: string; pageId: string };
    const {
      type,          // 'optin' | 'page_view' | 'purchase'
      contactData,   // {email, firstName, lastName, phone}
      context = {},
      tenantId,      // passé par le frontend (public, vérifié en DB)
    } = request.body as {
      type: 'optin' | 'page_view' | 'purchase';
      contactData?: { email?: string; firstName?: string; lastName?: string; phone?: string };
      context?: Record<string, unknown>;
      tenantId: string;
    };

    if (!tenantId) return reply.status(400).send({ error: 'tenantId_required' });
    if (!['optin', 'page_view', 'purchase'].includes(type)) {
      return reply.status(400).send({ error: 'invalid_trigger_type' });
    }

    // Vérifier que le tenant et la page existent
    const [tenant] = await sql<{ id: string }[]>`
      SELECT id FROM public.tenants WHERE id = ${tenantId} LIMIT 1
    `;
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });

    const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
    await sql.unsafe(`SET search_path = "${schemaName}", public`);

    const [page] = await sql<{ id: string }[]>`SELECT id FROM funnel_pages WHERE id = ${pageId}`;
    if (!page) return reply.status(404).send({ error: 'page_not_found' });

    // Créer ou retrouver le contact
    let contactId: string | null = null;
    if (contactData?.email) {
      const [existing] = await sql<{ id: string }[]>`
        SELECT id FROM contacts WHERE email = ${contactData.email} LIMIT 1
      `;
      if (existing) {
        contactId = existing.id;
        if (contactData.firstName || contactData.lastName || contactData.phone) {
          await sql`
            UPDATE contacts SET
              first_name = COALESCE(${contactData.firstName ?? null}, first_name),
              last_name  = COALESCE(${contactData.lastName  ?? null}, last_name),
              phone      = COALESCE(${contactData.phone     ?? null}, phone)
            WHERE id = ${contactId}
          `;
        }
      } else {
        const [nc] = await sql<{ id: string }[]>`
          INSERT INTO contacts (email, first_name, last_name, phone)
          VALUES (
            ${contactData.email},
            ${contactData.firstName ?? null},
            ${contactData.lastName  ?? null},
            ${contactData.phone     ?? null}
          )
          RETURNING id
        `;
        contactId = nc.id;
      }
    }

    // Enregistrer l'événement
    if (contactId) {
      await sql`
        INSERT INTO events (contact_id, type, payload)
        VALUES (${contactId}, ${type === 'optin' ? 'form_submit' : type}, ${JSON.stringify({ pageId, funnelId, ...context })}::jsonb)
      `;
    }

    // Déclencher les règles d'automatisation
    const rulesQueued = contactId
      ? await fireFunnelRules({ tenantId, tenantSchema: schemaName, pageId, triggerType: type, contactId, context })
      : 0;

    return reply.status(200).send({
      ok: true,
      contactId,
      rulesQueued,
    });
  });
}
