import type { SMSProvider, SMSResult } from '../types.js';

export function createInfobipProvider(credentials: Record<string, string>): SMSProvider {
  const { apiKey, baseUrl } = credentials;
  if (!apiKey || !baseUrl) {
    throw new Error('Infobip: apiKey et baseUrl sont requis');
  }

  return {
    name: 'infobip',
    async send(to, message, senderId): Promise<SMSResult> {
      const res = await fetch(`${baseUrl}/sms/2/text/advanced`, {
        method: 'POST',
        headers: {
          Authorization: `App ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          messages: [{
            from: senderId ?? 'AfriFlow',
            destinations: [{ to }],
            text: message,
          }],
        }),
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        return { success: false, provider: 'infobip', error: `HTTP ${res.status}` };
      }

      const msgs = (data.messages as Array<Record<string, unknown>>) ?? [];
      const first = msgs[0];
      const status = (first?.status as Record<string, string>)?.groupName;

      if (status === 'PENDING' || status === 'DELIVERED') {
        return { success: true, messageId: first.messageId as string, provider: 'infobip' };
      }

      return { success: false, provider: 'infobip', error: status ?? 'Unknown' };
    },
  };
}
