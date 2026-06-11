import crypto from 'crypto';
import type { PaymentProvider, InitiateParams, PaymentSession, PaymentStatus, WebhookEvent } from '../types.js';

const BASE = 'https://api.wave.com/v1';

async function waveFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.WAVE_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export const wave: PaymentProvider = {
  name: 'wave',
  currencies: ['XOF', 'XAF'],
  countries: ['SN', 'CI', 'ML', 'BF', 'GN'],

  async initiate(params: InitiateParams): Promise<PaymentSession> {
    const data = await waveFetch('/checkout/sessions', {
      method: 'POST',
      body: JSON.stringify({
        amount: String(Math.round(params.amount)),
        currency: params.currency,
        error_url: params.callbackUrl + '?status=error',
        success_url: params.callbackUrl + '?status=success',
        client_reference: params.contactId,
      }),
    });
    return {
      reference: data.id as string,
      paymentUrl: data.wave_launch_url as string,
      provider: 'wave',
    };
  },

  async verify(reference: string): Promise<PaymentStatus> {
    const data = await waveFetch(`/checkout/sessions/${reference}`);
    return {
      reference,
      status: data.payment_status === 'succeeded' ? 'success' : 'failed',
      amount: Number(data.amount),
      currency: data.currency as string,
    };
  },

  async handleWebhook(body: unknown, signature: string): Promise<WebhookEvent> {
    const secret = process.env.WAVE_WEBHOOK_SECRET!;
    const hash = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');
    if (hash !== signature) throw new Error('Invalid Wave webhook signature');

    const event = body as Record<string, unknown>;
    return {
      reference: event.id as string,
      status: event.payment_status === 'succeeded' ? 'success' : 'failed',
      amount: Number(event.amount),
      currency: event.currency as string,
    };
  },
};
