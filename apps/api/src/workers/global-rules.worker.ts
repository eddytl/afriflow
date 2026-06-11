import { Worker, Queue } from 'bullmq';
import { bullmqConnection } from '../lib/redis.js';
import { sql } from '../lib/db.js';
import { Resend } from 'resend';
import { sendSMS } from '@afriflow/sms';

export const globalRulesQueue = new Queue('global-rules', { connection: bullmqConnection });

interface GlobalRuleJob {
  tenantId: string;
  tenantSchema: string;
  ruleId: string;
  contactId: string;
  triggerType: string;
  context: Record<string, unknown>;
}

interface Action {
  type: string;
  params: Record<string, unknown>;
}

let _resend: InstanceType<typeof Resend> | null = null;
const getResend = () => {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY ?? 'placeholder');
  return _resend;
};

async function executeAction(
  action: Action,
  contactId: string,
  context: Record<string, unknown>,
  tenantSchema: string,
  tenantId: string,
): Promise<{ ok: boolean; detail?: string }> {

  await sql.unsafe(`SET search_path = "${tenantSchema}", public`);

  const [contact] = await sql<{
    id: string; email: string | null; phone: string | null;
    first_name: string | null; last_name: string | null; tags: string[];
  }[]>`SELECT id, email, phone, first_name, last_name, tags FROM contacts WHERE id = ${contactId}`;

  if (!contact) return { ok: false, detail: 'contact_not_found' };

  switch (action.type) {

    // ── Tags ────────────────────────────────────────────────────
    case 'add_tag': {
      const tagName = String(action.params.tagName);
      if (!contact.tags.includes(tagName)) {
        await sql`UPDATE contacts SET tags = array_append(tags, ${tagName}) WHERE id = ${contactId}`;
      }
      return { ok: true };
    }
    case 'remove_tag': {
      await sql`UPDATE contacts SET tags = array_remove(tags, ${String(action.params.tagName)}) WHERE id = ${contactId}`;
      return { ok: true };
    }

    // ── Campagnes ───────────────────────────────────────────────
    case 'subscribe_campaign': {
      await sql`
        INSERT INTO events (contact_id, type, payload)
        VALUES (${contactId}, 'campaign_subscribed', ${JSON.stringify({ campaignId: action.params.campaignId })}::jsonb)
        ON CONFLICT DO NOTHING
      `;
      return { ok: true };
    }
    case 'unsubscribe_campaign': {
      await sql`
        INSERT INTO events (contact_id, type, payload)
        VALUES (${contactId}, 'campaign_unsubscribed', ${JSON.stringify({ campaignId: action.params.campaignId })}::jsonb)
      `;
      return { ok: true };
    }

    // ── Emails ──────────────────────────────────────────────────
    case 'send_email': {
      if (!contact.email) return { ok: false, detail: 'no_email' };
      const subject  = interpolate(String(action.params.subject), contact, context);
      const body     = interpolate(String(action.params.body),    contact, context);
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

    // ── SMS ─────────────────────────────────────────────────────
    case 'send_sms': {
      const to = contact.phone;
      if (!to) return { ok: false, detail: 'no_phone' };

      const [tenant] = await sql<{ settings: { sms?: unknown } }[]>`
        SELECT settings FROM public.tenants WHERE id = ${tenantId} LIMIT 1
      `;
      const smsConfig = tenant?.settings?.sms as import('@afriflow/sms').SMSConfig | null;
      if (!smsConfig) return { ok: false, detail: 'sms_not_configured' };

      const message = interpolate(String(action.params.message), contact, context);
      await sendSMS(smsConfig, to, message);
      return { ok: true };
    }

    // ── Webhook ─────────────────────────────────────────────────
    case 'call_webhook': {
      const url    = String(action.params.url);
      const method = String(action.params.method ?? 'POST').toUpperCase();
      const extraHeaders = action.params.headers ? JSON.parse(String(action.params.headers)) : {};
      const bodyTpl = action.params.bodyTpl
        ? interpolate(String(action.params.bodyTpl), contact, context)
        : JSON.stringify({ contactId, email: contact.email, context });

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: method !== 'GET' ? bodyTpl : undefined,
      });
      return { ok: res.ok, detail: `HTTP ${res.status}` };
    }

    // ── Pipeline ────────────────────────────────────────────────
    case 'add_to_pipeline_stage': {
      const { pipelineId, stageId, dealTitle } = action.params as {
        pipelineId: string; stageId: string; dealTitle?: string;
      };
      const [existing] = await sql<{ id: string }[]>`
        SELECT id FROM pipeline_deals
        WHERE pipeline_id = ${pipelineId} AND contact_id = ${contactId} AND status = 'open'
        LIMIT 1
      `;
      if (existing) {
        await sql`UPDATE pipeline_deals SET stage_id = ${stageId} WHERE id = ${existing.id}`;
      } else {
        await sql`
          INSERT INTO pipeline_deals (pipeline_id, stage_id, contact_id, title)
          VALUES (${pipelineId}, ${stageId}, ${contactId},
                  ${dealTitle ?? `Deal ${contact.first_name ?? contact.email ?? contactId}`})
        `;
      }
      return { ok: true };
    }

    // ── Formations / Communautés ────────────────────────────────
    case 'enroll_course':
    case 'revoke_course':
    case 'enroll_course_pack':
    case 'revoke_course_pack':
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

// ── Worker ────────────────────────────────────────────────────────
export const globalRulesWorker = new Worker<GlobalRuleJob>(
  'global-rules',
  async (job) => {
    const { ruleId, contactId, triggerType, context, tenantSchema, tenantId } = job.data;

    await sql.unsafe(`SET search_path = "${tenantSchema}", public`);

    const [rule] = await sql<{
      id: string;
      actions: Action[];
      status: string;
    }[]>`SELECT id, actions, status FROM automation_rules WHERE id = ${ruleId}`;

    if (!rule || rule.status !== 'active') return;

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

    await sql`UPDATE automation_rules SET run_count = run_count + 1, updated_at = now() WHERE id = ${ruleId}`;

    await sql`
      INSERT INTO automation_rule_executions (rule_id, contact_id, trigger_type, status, result, error)
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

// ── Helper : déclencher les règles globales pour un événement ─────
export async function fireGlobalRules(opts: {
  tenantId: string;
  tenantSchema: string;
  triggerType: string;
  contactId: string;
  context?: Record<string, unknown>;
}) {
  const { tenantId, tenantSchema, triggerType, contactId, context = {} } = opts;

  await sql.unsafe(`SET search_path = "${tenantSchema}", public`);

  const rules = await sql<{ id: string }[]>`
    SELECT id FROM automation_rules
    WHERE trigger_type = ${triggerType} AND status = 'active'
  `;

  for (const rule of rules) {
    await globalRulesQueue.add(
      `rule-${rule.id}-${contactId}`,
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
