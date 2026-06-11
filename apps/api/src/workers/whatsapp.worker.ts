import { Worker, type Job } from 'bullmq';
import { redis, bullmqConnection } from '../lib/redis.js';
import { sql } from '../lib/db.js';

interface WhatsAppJob {
  type?: 'campaign-send' | 'automation-wa' | 'chatbot-reply';
  campaignId?: string;
  tenantId?: string;
  phone?: string;
  templateName?: string;
  variables?: string[];
  message?: string;
  replyTo?: string;
}

const WATI_URL = process.env.WATI_BASE_URL;
const WATI_TOKEN = process.env.WATI_TOKEN;

async function sendTemplate(phone: string, templateName: string, variables: string[]) {
  const res = await fetch(`${WATI_URL}/api/v1/sendTemplateMessage?whatsappNumber=${phone}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WATI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      template_name: templateName,
      broadcast_name: templateName,
      parameters: variables.map((v) => ({ name: 'var', value: v })),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WATI error ${res.status}: ${text}`);
  }
  return res.json();
}

async function sendTextMessage(phone: string, message: string) {
  const res = await fetch(`${WATI_URL}/api/v1/sendSessionMessage/${phone}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WATI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messageText: message }),
  });
  if (!res.ok) throw new Error(`WATI text error ${res.status}`);
  return res.json();
}

export function createWhatsAppWorker() {
  const worker = new Worker<WhatsAppJob>('whatsapp', async (job) => {
    const data = job.data;

    if (data.type === 'campaign-send' && data.campaignId && data.tenantId) {
      const schemaName = `tenant_${data.tenantId.replace(/-/g, '_')}`;
      await sql.unsafe(`SET search_path = "${schemaName}", public`);

      const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${data.campaignId}`;
      if (!campaign || campaign.type !== 'whatsapp') return;

      const contacts = await sql<{ id: string; whatsapp: string; first_name: string }[]>`
        SELECT id, whatsapp, first_name FROM contacts
        WHERE unsubscribed = false AND whatsapp IS NOT NULL
      `;

      let sent = 0;
      for (const contact of contacts) {
        try {
          await sendTextMessage(contact.whatsapp, campaign.body);
          sent++;
        } catch (err) {
          console.error(`[WAWorker] Failed for ${contact.whatsapp}:`, err);
        }
      }

      await sql`
        UPDATE campaigns SET status = 'sent', stats = jsonb_set(stats, '{sent}', ${String(sent)}::jsonb)
        WHERE id = ${data.campaignId}
      `;
      return;
    }

    if (data.phone && data.templateName) {
      await sendTemplate(data.phone, data.templateName, data.variables ?? []);
    }
  }, {
    connection: bullmqConnection,
    concurrency: 3,
    limiter: { max: 80, duration: 1000 }, // respect Meta rate limit
  });

  worker.on('failed', (job, err) => {
    console.error(`[WAWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
