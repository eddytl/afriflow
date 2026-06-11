import type { SMSProvider, SMSResult } from '../types.js';

// Termii — fournisseur SMS populaire en Afrique de l'Ouest et au Nigeria
export function createTermiiProvider(credentials: Record<string, string>): SMSProvider {
  const { apiKey } = credentials;
  if (!apiKey) throw new Error('Termii: apiKey est requis');

  return {
    name: 'termii',
    async send(to, message, senderId): Promise<SMSResult> {
      const res = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          from: senderId ?? 'AfriFlow',
          sms: message,
          type: 'plain',
          channel: 'generic',
          api_key: apiKey,
        }),
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok || data.code === 'ok' === false) {
        return { success: false, provider: 'termii', error: String(data.message ?? `HTTP ${res.status}`) };
      }

      return { success: true, messageId: data.message_id as string, provider: 'termii' };
    },
  };
}
