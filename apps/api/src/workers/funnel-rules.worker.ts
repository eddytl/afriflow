import { Worker, Queue } from 'bullmq';
import { bullmqConnection } from '../lib/redis.js';
import { sql } from '../lib/db.js';
import { Resend } from 'resend';
import { sendSMS } from '@afriflow/sms';

export const funnelRulesQueue = new Queue('funnel-rules', { connection: bullmqConnection });

interface RuleTriggerJob {
  tenantId: string;
  tenantSchema: string;
  ruleId: string;
  contactId: string;
  triggerType: string;
  context: Record<string, unknown>; // données de l'événement déclencheur
}

interface Action {
  type: string;
  params: Record<string, unknown>;
}

const getResend = () => new Resend(process.env.RESEND_API_KEY ?? 'placeholder');

async function executeAction(
  action: Action,
  contactId: string,
  context: Record<string, unknown>,
  tenantSchema: string,
  tenantId: string,
): Promise<{ ok: boolean; detail?: string }> {

  await sql.unsafe(`SET search_path = "${tenantSchema}", public`);

  // Charger le contact
  const [contact] = await sql<{
    id: string; email: string | null; first_name: string | null; last_name: string | null;
    phone: string | null; tags: string[];
  }[]>`SELECT id, email, first_name, last_name, phone, tags FROM contacts WHERE id = ${contactId}`;

  if (!contact) return { ok: false, detail: 'contact_not_found' };

  switch (action.type) {

    // ── Tags ────────────────────────────────────────────────
    case 'add_tag': {
      const tagName = String(action.params.tagName);
      if (!contact.tags.includes(tagName)) {
        await sql`UPDATE contacts SET tags = array_append(tags, ${tagName}) WHERE id = ${contactId}`;
      }
      return { ok: true };
    }
    case 'remove_tag': {
      const tagName = String(action.params.tagName);
      await sql`UPDATE contacts SET tags = array_remove(tags, ${tagName}) WHERE id = ${contactId}`;
      return { ok: true };
    }

    // ── Campagnes ────────────────────────────────────────────
    case 'subscribe_campaign': {
      // Enregistrer l'abonnement dans le contexte de la campagne (champ segmentFilter)
      // Ici on ajoute un tag spécial "campaign:{id}" ou on ajoute le contact dans un future table campaign_contacts
      const campaignId = String(action.params.campaignId);
      await sql`
        INSERT INTO events (contact_id, type, payload)
        VALUES (${contactId}, 'campaign_subscribed', ${JSON.stringify({ campaignId })}::jsonb)
      `;
      return { ok: true };
    }
    case 'unsubscribe_campaign': {
      const campaignId = String(action.params.campaignId);
      await sql`
        INSERT INTO events (contact_id, type, payload)
        VALUES (${contactId}, 'campaign_unsubscribed', ${JSON.stringify({ campaignId })}::jsonb)
      `;
      return { ok: true };
    }

    // ── Emails ───────────────────────────────────────────────
    case 'send_email': {
      if (!contact.email) return { ok: false, detail: 'no_email' };
      const subject = interpolate(String(action.params.subject), contact, context);
      const body    = interpolate(String(action.params.body),    contact, context);
      const fromName = action.params.fromName ?? 'AfriFlow';
      await getResend().emails.send({
        from:    `${fromName} <noreply@${process.env.EMAIL_DOMAIN ?? 'afriflow.app'}>`,
        to:      contact.email,
        subject,
        html:    body,
      });
      return { ok: true };
    }
    case 'send_email_specific': {
      const subject = interpolate(String(action.params.subject), contact, context);
      const body    = interpolate(String(action.params.body),    contact, context);
      await getResend().emails.send({
        from:    `AfriFlow <noreply@${process.env.EMAIL_DOMAIN ?? 'afriflow.app'}>`,
        to:      String(action.params.to),
        subject,
        html:    body,
      });
      return { ok: true };
    }

    // ── SMS ──────────────────────────────────────────────────
    case 'send_sms': {
      const to = contact.phone ?? null;
      if (!to) return { ok: false, detail: 'no_phone' };

      // Charger la config SMS du tenant
      const [tenant] = await sql<{ settings: { sms?: unknown } }[]>`
        SELECT settings FROM public.tenants WHERE id = ${tenantId} LIMIT 1
      `;
      const smsConfig = tenant?.settings?.sms as import('@afriflow/sms').SMSConfig | null;
      if (!smsConfig) return { ok: false, detail: 'sms_not_configured' };

      const message = interpolate(String(action.params.message), contact, context);
      await sendSMS(smsConfig, to, message);
      return { ok: true };
    }

    // ── Webhook ──────────────────────────────────────────────
    case 'call_webhook': {
      const url    = String(action.params.url);
      const method = String(action.params.method ?? 'POST').toUpperCase();
      const extraHeaders = action.params.headers
        ? JSON.parse(String(action.params.headers))
        : {};
      const bodyTpl = action.params.bodyTpl
        ? interpolate(String(action.params.bodyTpl), contact, context)
        : JSON.stringify({ contactId, email: contact.email, context });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000); // 10 s max
      try {
        const res = await fetch(url, {
          method,
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...extraHeaders },
          body: method !== 'GET' ? bodyTpl : undefined,
        });
        return { ok: res.ok, detail: `HTTP ${res.status}` };
      } catch (err) {
        const detail = err instanceof Error && err.name === 'AbortError'
          ? 'timeout'
          : err instanceof Error ? err.message : String(err);
        return { ok: false, detail };
      } finally {
        clearTimeout(timeout);
      }
    }

    // ── Pipeline ─────────────────────────────────────────────
    case 'add_to_pipeline_stage': {
      const { pipelineId, stageId, dealTitle } = action.params as {
        pipelineId: string; stageId: string; dealTitle?: string;
      };
      // Vérifier si le contact a déjà un deal dans ce pipeline
      const [existing] = await sql<{ id: string }[]>`
        SELECT id FROM pipeline_deals WHERE pipeline_id = ${pipelineId} AND contact_id = ${contactId} AND status = 'open' LIMIT 1
      `;
      if (existing) {
        // Déplacer vers la nouvelle étape
        await sql`UPDATE pipeline_deals SET stage_id = ${stageId} WHERE id = ${existing.id}`;
      } else {
        // Créer un nouveau deal
        await sql`
          INSERT INTO pipeline_deals (pipeline_id, stage_id, contact_id, title)
          VALUES (${pipelineId}, ${stageId}, ${contactId},
                  ${dealTitle ?? `Deal ${contact.first_name ?? contact.email ?? contactId}`})
        `;
      }
      return { ok: true };
    }

    // ── Formations / Communautés (stub — sera implémenté avec le module Courses) ─
    case 'enroll_course':
    case 'revoke_course':
    case 'grant_community':
    case 'revoke_community': {
      await sql`
        INSERT INTO events (contact_id, type, payload)
        VALUES (${contactId}, ${action.type}, ${JSON.stringify(action.params)}::jsonb)
      `;
      return { ok: true, detail: 'queued' };
    }

    default:
      return { ok: false, detail: `unknown_action: ${action.type}` };
  }
}

// Interpolation de variables dans les templates : {{first_name}}, {{email}}, etc.
function interpolate(
  template: string,
  contact: { first_name: string | null; last_name: string | null; email: string | null },
  context: Record<string, unknown>,
): string {
  return template
    .replace(/\{\{first_name\}\}/g, contact.first_name ?? '')
    .replace(/\{\{last_name\}\}/g,  contact.last_name  ?? '')
    .replace(/\{\{email\}\}/g,       contact.email      ?? '')
    .replace(/\{\{(\w+)\}\}/g, (_, key) => String(context[key] ?? ''));
}

// ── Worker ────────────────────────────────────────────────────
export const funnelRulesWorker = new Worker<RuleTriggerJob>(
  'funnel-rules',
  async (job) => {
    const { ruleId, contactId, triggerType, context, tenantSchema, tenantId } = job.data;

    await sql.unsafe(`SET search_path = "${tenantSchema}", public`);

    const [rule] = await sql<{
      id: string;
      actions: Action[];
      is_active: boolean;
    }[]>`SELECT id, actions, is_active FROM funnel_automation_rules WHERE id = ${ruleId}`;

    if (!rule || !rule.is_active) return;

    const results: Record<string, unknown>[] = [];
    let hasError = false;
    let errorMsg: string | undefined;

    for (const action of (rule.actions as Action[])) {
      try {
        const res = await executeAction(action, contactId, context, tenantSchema, tenantId);
        results.push({ type: action.type, ...res });
        if (!res.ok) hasError = true;
      } catch (err) {
        hasError = true;
        errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ type: action.type, ok: false, detail: errorMsg });
      }
    }

    // Incrémenter le compteur d'exécutions
    await sql`UPDATE funnel_automation_rules SET run_count = run_count + 1, updated_at = now() WHERE id = ${ruleId}`;

    // Log
    await sql`
      INSERT INTO funnel_rule_executions (rule_id, contact_id, trigger_type, status, result, error)
      VALUES (
        ${ruleId}, ${contactId}, ${triggerType},
        ${hasError ? 'error' : 'success'},
        ${JSON.stringify(results)}::jsonb,
        ${errorMsg ?? null}
      )
    `;
  },
  {
    connection: bullmqConnection,
    concurrency: 20,
  },
);

// ── Helper : déclencher les règles pour un événement ────────
export async function fireFunnelRules(opts: {
  tenantId: string;
  tenantSchema: string;
  pageId: string;
  triggerType: 'optin' | 'page_view' | 'purchase';
  contactId: string;
  context?: Record<string, unknown>;
}) {
  const { tenantId, tenantSchema, pageId, triggerType, contactId, context = {} } = opts;

  await sql.unsafe(`SET search_path = "${tenantSchema}", public`);

  const rules = await sql<{ id: string }[]>`
    SELECT id FROM funnel_automation_rules
    WHERE page_id = ${pageId}
      AND is_active = true
      AND trigger->>'type' = ${triggerType}
  `;

  for (const rule of rules) {
    await funnelRulesQueue.add(
      `rule-${rule.id}`,
      { tenantId, tenantSchema, ruleId: rule.id, contactId, triggerType, context },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 7 * 86400 },
        removeOnFail:     { age: 30 * 86400 },
      },
    );
  }

  return rules.length;
}
