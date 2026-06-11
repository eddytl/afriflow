import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { paymentQueue } from '../../lib/queue.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';
import { selectProvider, getProviderByName } from '@afriflow/payments';

const initiateSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  country: z.string().length(2),
  contactId: z.string().uuid(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function paymentRoutes(app: FastifyInstance) {
  app.post('/initiate', hooks, async (request, reply) => {
    const body = initiateSchema.parse(request.body);
    const tenantId = (request.user as { tenantId: string }).tenantId;

    const provider = selectProvider(body.country);

    // Créer la transaction dans la table publique
    const [transaction] = await sql<{ id: string }[]>`
      INSERT INTO public.payment_transactions (tenant_id, amount, currency, provider, status)
      VALUES (${tenantId}, ${body.amount}, ${body.currency}, ${provider.name}, 'pending')
      RETURNING id
    `;

    const callbackUrl = `${process.env.API_URL}/api/v1/payments/callback/${transaction.id}`;
    const session = await provider.initiate({
      ...body,
      callbackUrl,
      metadata: { transactionId: transaction.id, tenantId },
    });

    await sql`
      UPDATE public.payment_transactions SET provider_ref = ${session.reference}
      WHERE id = ${transaction.id}
    `;

    return reply.status(201).send({
      transactionId: transaction.id,
      paymentUrl: session.paymentUrl,
      reference: session.reference,
      provider: provider.name,
    });
  });

  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [tx] = await sql`SELECT * FROM public.payment_transactions WHERE id = ${id}`;
    if (!tx) return reply.status(404).send({ error: 'not_found' });
    return tx;
  });

  app.post('/webhook/:provider', async (request, reply) => {
    const { provider: providerName } = request.params as { provider: string };
    const signature = (request.headers['x-paystack-signature'] ??
      request.headers['verif-hash'] ??
      request.headers['x-wave-signature'] ?? '') as string;

    try {
      const provider = getProviderByName(providerName);
      const event = await provider.handleWebhook(request.body, signature);

      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      await paymentQueue.add('webhook', {
        providerName,
        event,
        idempotencyKey,
      }, {
        jobId: idempotencyKey, // idempotence BullMQ
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      });

      return reply.status(200).send({ received: true });
    } catch (err) {
      app.log.warn({ err, provider: providerName }, 'Webhook rejected');
      return reply.status(400).send({ error: 'invalid_webhook' });
    }
  });

  app.get('/transactions', hooks, async (request) => {
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const q = request.query as { after?: string; limit?: string; status?: string; provider?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    return sql`
      SELECT * FROM public.payment_transactions
      WHERE tenant_id = ${tenantId}
        AND (${q.status ?? null} IS NULL OR status = ${q.status ?? null})
        AND (${q.provider ?? null} IS NULL OR provider = ${q.provider ?? null})
        AND (${q.after ?? null}::uuid IS NULL OR id > ${q.after ?? null}::uuid)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  });
}
