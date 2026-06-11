import { Worker } from 'bullmq';
import { redis, bullmqConnection } from '../lib/redis.js';
import { sql } from '../lib/db.js';
import { sendSMS, sendBulkSMS, type SMSConfig, type SMSResult } from '@afriflow/sms';
import { interpolateSMS } from '../routes/sms/index.js';

interface SMSJob {
  type?:       'campaign-send' | 'automation-sms' | 'rule-sms';
  campaignId?: string;
  templateId?: string;
  tenantId?:   string;
  contactId?:  string;
  phone?:      string;
  message?:    string;
  country?:    string;
}

async function getSMSConfig(tenantId: string): Promise<SMSConfig | null> {
  const [tenant] = await sql<{ settings: Record<string, unknown> }[]>`
    SELECT settings FROM public.tenants WHERE id = ${tenantId}
  `;
  return (tenant?.settings?.sms as SMSConfig | undefined) ?? null;
}

async function logSMS(opts: {
  tenantSchema: string;
  contactId:    string | null;
  templateId?:  string | null;
  campaignId?:  string | null;
  toNumber:     string;
  message:      string;
  result:       SMSResult;
  provider:     string;
}) {
  await sql.unsafe(`SET search_path = "${opts.tenantSchema}", public`);
  await sql`
    INSERT INTO sms_logs
      (contact_id, template_id, campaign_id, to_number, message, status, provider, provider_id, error)
    VALUES (
      ${opts.contactId   ?? null},
      ${opts.templateId  ?? null},
      ${opts.campaignId  ?? null},
      ${opts.toNumber},
      ${opts.message},
      ${opts.result.success ? 'sent' : 'failed'},
      ${opts.provider},
      ${opts.result.messageId ?? null},
      ${opts.result.error     ?? null}
    )
  `;
}

export function createSmsWorker() {
  const worker = new Worker<SMSJob>('sms', async (job) => {
    const data = job.data;

    // ── Campagne SMS (envoi groupé) ────────────────────────
    if (data.type === 'campaign-send' && data.campaignId && data.tenantId) {
      const smsConfig = await getSMSConfig(data.tenantId);
      if (!smsConfig) throw new Error(`Tenant ${data.tenantId} : fournisseur SMS non configuré`);

      const schemaName = `tenant_${data.tenantId.replace(/-/g, '_')}`;
      await sql.unsafe(`SET search_path = "${schemaName}", public`);

      const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${data.campaignId}`;
      if (!campaign || campaign.type !== 'sms') return;

      // Charger les contacts correspondant au segmentFilter
      const contacts = await sql<{
        id: string; phone: string; country: string; email: string | null;
        first_name: string | null; last_name: string | null; custom_fields: Record<string, unknown>;
      }[]>`
        SELECT id, phone, country, email, first_name, last_name, custom_fields
        FROM contacts
        WHERE unsubscribed = false AND phone IS NOT NULL
      `;

      // Charger le template si référencé
      let templateId: string | null = null;
      if (campaign.settings?.templateId) {
        templateId = String(campaign.settings.templateId);
      }

      let sent = 0;
      let failed = 0;

      // Envoi individuel pour pouvoir logger chaque résultat + interpoler les variables
      for (const contact of contacts) {
        const message = interpolateSMS(campaign.body as string, contact as Record<string, unknown>);
        const result  = await sendSMS(smsConfig, contact.phone, message);
        if (result.success) sent++; else failed++;

        await logSMS({
          tenantSchema: schemaName,
          contactId:    contact.id,
          templateId,
          campaignId:   data.campaignId!,
          toNumber:     contact.phone,
          message,
          result,
          provider:     smsConfig.provider,
        });
      }

      await sql.unsafe(`SET search_path = "${schemaName}", public`);
      await sql`
        UPDATE campaigns
        SET status = 'sent',
            stats  = jsonb_set(
              jsonb_set(stats, '{sent}',   ${String(sent)}::jsonb),
              '{failed}', ${String(failed)}::jsonb
            )
        WHERE id = ${data.campaignId}
      `;
      return;
    }

    // ── SMS automation / rule unitaire ────────────────────
    if (data.phone && data.message && data.tenantId) {
      const smsConfig = await getSMSConfig(data.tenantId);
      if (!smsConfig) throw new Error(`Tenant ${data.tenantId} : fournisseur SMS non configuré`);

      const schemaName = `tenant_${data.tenantId.replace(/-/g, '_')}`;

      // Interpoler si on a un contactId
      let message = data.message;
      if (data.contactId) {
        await sql.unsafe(`SET search_path = "${schemaName}", public`);
        const [contact] = await sql<Record<string, unknown>[]>`
          SELECT email, first_name, last_name, phone, country, custom_fields
          FROM contacts WHERE id = ${data.contactId}
        `;
        if (contact) message = interpolateSMS(data.message, contact);
      }

      const result = await sendSMS(smsConfig, data.phone, message);

      await logSMS({
        tenantSchema: schemaName,
        contactId:    data.contactId ?? null,
        templateId:   data.templateId ?? null,
        campaignId:   null,
        toNumber:     data.phone,
        message,
        result,
        provider:     smsConfig.provider,
      });

      if (!result.success) throw new Error(result.error ?? 'SMS send failed');
    }
  }, {
    connection: bullmqConnection,
    concurrency: 10,
  });

  worker.on('failed', (job, err) => {
    console.error(`[SMSWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
