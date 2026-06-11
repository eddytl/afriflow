import { Worker, type Job } from 'bullmq';
import { redis, bullmqConnection } from '../lib/redis.js';
import { sql } from '../lib/db.js';
import { sendEmail } from '@afriflow/email';
import { WelcomeEmail } from '@afriflow/email';
import { CampaignEmail } from '@afriflow/email';
import React from 'react';

interface EmailJob {
  type: 'campaign-send' | 'automation-email' | 'transactional';
  campaignId?: string;
  contactId?: string;
  enrollmentId?: string;
  templateId?: string;
  tenantId?: string;
  to?: string;
  subject?: string;
  body?: string;
}

async function getTenantSettings(tenantId: string) {
  const [tenant] = await sql<{ settings: Record<string, string>; owner_email: string; slug: string }[]>`
    SELECT settings, owner_email, slug FROM public.tenants WHERE id = ${tenantId}
  `;
  return {
    senderName: tenant?.settings?.senderName ?? tenant?.slug ?? 'AfriFlow',
    senderEmail: tenant?.settings?.senderEmail ?? `noreply@${tenant?.slug ?? 'afriflow'}.afriflow.app`,
    platformUrl: `${process.env.WEB_URL}/${tenant?.slug}`,
    tenantId,
  };
}

const CAMPAIGN_BATCH_SIZE = 200;

async function handleCampaignSend(job: Job<EmailJob>) {
  const { campaignId, tenantId } = job.data;
  if (!campaignId || !tenantId) return;

  const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
  await sql.unsafe(`SET search_path = "${schemaName}", public`);

  const [campaign] = await sql`
    SELECT id, type, subject, body FROM campaigns WHERE id = ${campaignId}
  `;
  if (!campaign || campaign.type !== 'email') return;

  const settings = await getTenantSettings(tenantId);
  let sent = 0;
  let lastId: string | null = null;

  // Traitement par batches de 200 — évite de charger tous les contacts en mémoire
  while (true) {
    type ContactBatch = { id: string; email: string; first_name: string; country: string };
    const batch = (await sql`
      SELECT id, email, first_name, country FROM contacts
      WHERE unsubscribed = false AND bounced = false AND email IS NOT NULL
        ${lastId ? sql`AND id > ${lastId}::uuid` : sql``}
      ORDER BY id
      LIMIT ${CAMPAIGN_BATCH_SIZE}
    `) as unknown as ContactBatch[];
    if (batch.length === 0) break;

    const sentInBatch: string[] = [];
    for (const contact of batch) {
      try {
        await sendEmail({
          to: contact.email,
          subject: campaign.subject ?? 'Message de ' + settings.senderName,
          template: React.createElement(CampaignEmail, {
            firstName: contact.first_name ?? 'Ami',
            subject:   campaign.subject ?? '',
            body:      campaign.body,
            senderName: settings.senderName,
            unsubscribeUrl: `${process.env.API_URL}/unsubscribe?contactId=${contact.id}&tenantId=${tenantId}`,
          }),
          tenantId,
          senderName:     settings.senderName,
          senderEmail:    settings.senderEmail,
          unsubscribeUrl: `${process.env.API_URL}/unsubscribe?contactId=${contact.id}`,
        });
        sentInBatch.push(contact.id);
        sent++;
      } catch (err) {
        console.error(`[EmailWorker] Failed to send to ${contact.email}:`, err);
      }
    }

    // Insertion groupée des événements pour ce batch (1 query au lieu de N)
    if (sentInBatch.length > 0) {
      await sql`
        INSERT INTO events (contact_id, type, payload)
        SELECT UNNEST(${sentInBatch}::uuid[]),
               'email_sent',
               ${JSON.stringify({ campaignId })}::jsonb
      `;
    }

    // Mettre à jour le compteur après chaque batch pour le suivi en temps réel
    await sql`
      UPDATE campaigns
      SET stats = jsonb_set(stats, '{sent}', ${String(sent)}::jsonb)
      WHERE id = ${campaignId}
    `;

    lastId = batch[batch.length - 1].id;
    if (batch.length < CAMPAIGN_BATCH_SIZE) break;
  }

  await sql`
    UPDATE campaigns SET status = 'sent' WHERE id = ${campaignId}
  `;
}

export function createEmailWorker() {
  const worker = new Worker<EmailJob>('email', async (job) => {
    switch (job.data.type ?? 'campaign-send') {
      case 'campaign-send':
        await handleCampaignSend(job);
        break;
      default:
        break;
    }
  }, {
    connection: bullmqConnection,
    concurrency: 5,
    limiter: { max: 100, duration: 1000 }, // 100 emails/s
  });

  worker.on('failed', (job, err) => {
    console.error(`[EmailWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
