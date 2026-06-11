import { Worker, type Job } from 'bullmq';
import { redis, bullmqConnection } from '../lib/redis.js';
import { sql } from '../lib/db.js';
import { getProviderByName, type WebhookEvent } from '@afriflow/payments';
import { automationQueue } from '../lib/queue.js';

interface PaymentJob {
  providerName: string;
  event: WebhookEvent;
  idempotencyKey?: string;
}

export function createPaymentWorker() {
  const worker = new Worker<PaymentJob>('payment', async (job: Job<PaymentJob>) => {
    const { providerName, event } = job.data;

    // Trouver la transaction par référence provider
    const [tx] = await sql<{
      id: string; tenant_id: string; amount: number; currency: string; status: string;
    }[]>`
      SELECT id, tenant_id, amount, currency, status
      FROM public.payment_transactions
      WHERE provider_ref = ${event.reference} AND provider = ${providerName}
    `;

    if (!tx) {
      console.error(`[PaymentWorker] Transaction not found for ref ${event.reference}`);
      return;
    }
    if (tx.status !== 'pending') return; // déjà traité (idempotence)

    // Vérifier côté provider
    const provider = getProviderByName(providerName);
    const status = await provider.verify(event.reference);

    const newStatus = status.status;
    const commission = newStatus === 'success' ? tx.amount * 0.015 : null;

    await sql`
      UPDATE public.payment_transactions
      SET status = ${newStatus}, commission = ${commission}
      WHERE id = ${tx.id}
    `;

    if (newStatus === 'success') {
      const schemaName = `tenant_${tx.tenant_id.replace(/-/g, '_')}`;
      await sql.unsafe(`SET search_path = "${schemaName}", public`);

      const contactId = event.metadata?.contactId as string | undefined;
      if (contactId) {
        // Enregistrer l'événement purchase
        await sql`
          INSERT INTO events (contact_id, type, payload)
          VALUES (${contactId}, 'purchase', ${JSON.stringify({
            transactionId: tx.id,
            amount: tx.amount,
            currency: tx.currency,
            provider: providerName,
          })}::jsonb)
        `;

        // Déclencher les automatisations post-achat
        const postPurchaseAutomations = await sql<{ id: string }[]>`
          SELECT id FROM automations
          WHERE status = 'active' AND trigger->>'type' = 'purchase'
        `;

        for (const automation of postPurchaseAutomations) {
          await automationQueue.add('enroll', {
            automationId: automation.id,
            contactId,
            tenantId: tx.tenant_id,
          });
        }
      }
    }
  }, {
    connection: bullmqConnection,
    concurrency: 1, // idempotent, 1 seul worker
  });

  worker.on('failed', (job, err) => {
    console.error(`[PaymentWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
