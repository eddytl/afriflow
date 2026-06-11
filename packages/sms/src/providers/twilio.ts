import type { SMSProvider, SMSResult } from '../types.js';

export function createTwilioProvider(credentials: Record<string, string>): SMSProvider {
  const { accountSid, authToken, phoneNumber } = credentials;
  if (!accountSid || !authToken || !phoneNumber) {
    throw new Error('Twilio: accountSid, authToken et phoneNumber sont requis');
  }

  const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  return {
    name: 'twilio',
    async send(to, message, senderId): Promise<SMSResult> {
      const body = new URLSearchParams({
        To: to,
        From: senderId ?? phoneNumber,
        Body: message,
      });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        return {
          success: false,
          provider: 'twilio',
          error: String(data.message ?? `HTTP ${res.status}`),
        };
      }

      return { success: true, messageId: data.sid as string, provider: 'twilio' };
    },
  };
}
