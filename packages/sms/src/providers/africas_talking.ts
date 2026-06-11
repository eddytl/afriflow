import type { SMSProvider, SMSResult } from '../types.js';

export function createAfricasTalkingProvider(credentials: Record<string, string>): SMSProvider {
  const { apiKey, username } = credentials;
  if (!apiKey || !username) {
    throw new Error("Africa's Talking: apiKey et username sont requis");
  }

  const isSandbox = username === 'sandbox';
  const endpoint = isSandbox
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging';

  return {
    name: 'africas_talking',
    async send(to, message, senderId): Promise<SMSResult> {
      const body = new URLSearchParams({
        username,
        to,
        message,
        ...(senderId ? { from: senderId } : {}),
      });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          apiKey,
        },
        body: body.toString(),
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        return { success: false, provider: 'africas_talking', error: `HTTP ${res.status}` };
      }

      const recipients = (data.SMSMessageData as Record<string, unknown>)?.Recipients as Array<Record<string, string>>;
      const first = recipients?.[0];

      if (first?.status === 'Success') {
        return { success: true, messageId: first.messageId, provider: 'africas_talking' };
      }

      return {
        success: false,
        provider: 'africas_talking',
        error: first?.status ?? 'Envoi échoué',
      };
    },
  };
}
