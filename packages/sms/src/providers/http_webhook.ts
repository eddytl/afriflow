import type { SMSProvider, SMSResult } from '../types.js';

// Provider HTTP générique : l'admin configure une URL de webhook avec ses propres paramètres
export function createHttpWebhookProvider(credentials: Record<string, string>): SMSProvider {
  const { url, method = 'POST', toField = 'to', messageField = 'message', authHeader } = credentials;
  if (!url) throw new Error('HTTP Webhook: url est requise');

  return {
    name: 'http_webhook',
    async send(to, message, senderId): Promise<SMSResult> {
      const payload: Record<string, string> = {
        [toField]: to,
        [messageField]: message,
      };
      if (senderId) payload.from = senderId;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers.Authorization = authHeader;

      const res = await fetch(url, {
        method: method.toUpperCase(),
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return { success: false, provider: 'http_webhook', error: `HTTP ${res.status}` };
      }

      return { success: true, provider: 'http_webhook' };
    },
  };
}
