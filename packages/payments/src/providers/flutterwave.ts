import crypto from 'crypto';
import type { PaymentProvider, InitiateParams, PaymentSession, PaymentStatus, WebhookEvent } from '../types.js';

const BASE = 'https://api.flutterwave.com/v3';

async function flwFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export const flutterwave: PaymentProvider = {
  name: 'flutterwave',
  currencies: ['NGN', 'GHS', 'KES', 'UGX', 'TZS', 'XOF', 'XAF', 'USD'],
  countries: ['NG', 'GH', 'KE', 'UG', 'TZ', 'CI', 'SN', 'CM'],

  async initiate(params: InitiateParams): Promise<PaymentSession> {
    const reference = `AF-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const data = await flwFetch('/payments', {
      method: 'POST',
      body: JSON.stringify({
        tx_ref: reference,
        amount: params.amount,
        currency: params.currency,
        redirect_url: params.callbackUrl,
        customer: {
          email: params.email ?? `${params.contactId}@afriflow.app`,
          phonenumber: params.phone,
        },
        meta: { contactId: params.contactId, ...params.metadata },
      }),
    });
    const result = data.data as Record<string, string>;
    return {
      reference,
      paymentUrl: result.link,
      provider: 'flutterwave',
    };
  },

  async verify(reference: string): Promise<PaymentStatus> {
    const data = await flwFetch(`/transactions/${reference}/verify`);
    const t = data.data as Record<string, unknown>;
    return {
      reference,
      status: t.status === 'successful' ? 'success' : 'failed',
      amount: t.amount as number,
      currency: t.currency as string,
      paidAt: t.created_at ? new Date(t.created_at as string) : undefined,
    };
  },

  async handleWebhook(body: unknown, signature: string): Promise<WebhookEvent> {
    const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET!;
    const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
    if (hash !== signature) throw new Error('Invalid Flutterwave webhook signature');

    const event = body as Record<string, unknown>;
    const data = event.data as Record<string, unknown>;
    return {
      reference: data.tx_ref as string,
      status: data.status === 'successful' ? 'success' : 'failed',
      amount: data.amount as number,
      currency: data.currency as string,
    };
  },
};
