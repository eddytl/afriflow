import crypto from 'crypto';
import type { PaymentProvider, InitiateParams, PaymentSession, PaymentStatus, WebhookEvent } from '../types.js';

const BASE = 'https://api.paystack.co';

async function paystackFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export const paystack: PaymentProvider = {
  name: 'paystack',
  currencies: ['NGN', 'GHS', 'ZAR', 'USD'],
  countries: ['NG', 'GH', 'MA', 'ZA'],

  async initiate(params: InitiateParams): Promise<PaymentSession> {
    const data = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        amount: Math.round(params.amount * 100), // kobo/pesewa
        currency: params.currency,
        email: params.email ?? `${params.contactId}@afriflow.app`,
        callback_url: params.callbackUrl,
        metadata: { contactId: params.contactId, ...params.metadata },
      }),
    });
    const result = data.data as Record<string, string>;
    return {
      reference: result.reference,
      paymentUrl: result.authorization_url,
      provider: 'paystack',
    };
  },

  async verify(reference: string): Promise<PaymentStatus> {
    const data = await paystackFetch(`/transaction/verify/${reference}`);
    const t = data.data as Record<string, unknown>;
    return {
      reference,
      status: t.status === 'success' ? 'success' : 'failed',
      amount: (t.amount as number) / 100,
      currency: t.currency as string,
      paidAt: t.paid_at ? new Date(t.paid_at as string) : undefined,
      metadata: t.metadata as Record<string, unknown>,
    };
  },

  async handleWebhook(body: unknown, signature: string): Promise<WebhookEvent> {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET!;
    const hash = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(body))
      .digest('hex');
    if (hash !== signature) throw new Error('Invalid Paystack webhook signature');

    const event = body as Record<string, unknown>;
    const data = event.data as Record<string, unknown>;
    return {
      reference: data.reference as string,
      status: data.status === 'success' ? 'success' : 'failed',
      amount: (data.amount as number) / 100,
      currency: data.currency as string,
      metadata: data.metadata as Record<string, unknown>,
    };
  },
};
