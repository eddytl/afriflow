import type { SMSProvider, SMSResult } from '../types.js';

export function createOrangeProvider(credentials: Record<string, string>): SMSProvider {
  const { clientId, clientSecret, senderAddress } = credentials;
  if (!clientId || !clientSecret || !senderAddress) {
    throw new Error('Orange SMS: clientId, clientSecret et senderAddress sont requis');
  }

  let cachedToken: string | null = null;
  let tokenExpiry = 0;

  async function getAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

    const res = await fetch('https://api.orange.com/oauth/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    const data = await res.json() as { access_token: string; expires_in: number };
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
  }

  return {
    name: 'orange',
    async send(to, message, senderId): Promise<SMSResult> {
      const token = await getAccessToken();
      const from = senderId ?? senderAddress;

      const res = await fetch(
        `https://api.orange.com/smsmessaging/v1/outbound/${encodeURIComponent(from)}/requests`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            outboundSMSMessageRequest: {
              address: `tel:${to}`,
              senderAddress: from,
              outboundSMSTextMessage: { message },
            },
          }),
        }
      );

      if (!res.ok) {
        const err = await res.text();
        return { success: false, provider: 'orange', error: `HTTP ${res.status}: ${err}` };
      }

      const data = await res.json() as Record<string, unknown>;
      const requestId = (data.outboundSMSMessageRequest as Record<string, string>)?.resourceURL ?? '';
      return { success: true, messageId: requestId, provider: 'orange' };
    },
  };
}
