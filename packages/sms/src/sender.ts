import type { SMSConfig, SMSResult } from './types.js';
import { createSMSProvider } from './registry.js';

export async function sendSMS(
  config: SMSConfig,
  to: string,
  message: string
): Promise<SMSResult> {
  const provider = createSMSProvider(config);
  return provider.send(to, message, config.senderId);
}

export async function sendBulkSMS(
  config: SMSConfig,
  recipients: Array<{ to: string; message: string }>,
  concurrency = 10
): Promise<SMSResult[]> {
  const provider = createSMSProvider(config);
  const results: SMSResult[] = [];

  for (let i = 0; i < recipients.length; i += concurrency) {
    const batch = recipients.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((r) => provider.send(r.to, r.message, config.senderId))
    );
    results.push(
      ...settled.map((r) =>
        r.status === 'fulfilled'
          ? r.value
          : { success: false, provider: config.provider, error: String(r.reason) }
      )
    );
  }

  return results;
}
