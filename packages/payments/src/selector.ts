import type { PaymentProvider } from './types.js';
import { wave } from './providers/wave.js';
import { paystack } from './providers/paystack.js';
import { flutterwave } from './providers/flutterwave.js';

export function selectProvider(country: string): PaymentProvider {
  if (['SN', 'CI', 'ML', 'BF', 'GN'].includes(country)) return wave;
  if (['NG', 'GH', 'MA'].includes(country)) return paystack;
  if (['KE', 'UG', 'TZ'].includes(country)) return flutterwave;
  return flutterwave; // fallback global
}

export function getProviderByName(name: string): PaymentProvider {
  const providers: Record<string, PaymentProvider> = {
    wave,
    paystack,
    flutterwave,
  };
  if (!providers[name]) throw new Error(`Unknown provider: ${name}`);
  return providers[name];
}
