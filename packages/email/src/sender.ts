import { Resend } from 'resend';
import { render } from '@react-email/render';
import type { ReactElement } from 'react';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  template: ReactElement;
  tenantId: string;
  senderName: string;
  senderEmail: string;
  unsubscribeUrl?: string;
  replyTo?: string;
}

export function sendEmail(opts: SendEmailOptions) {
  const html = render(opts.template);

  const headers: Record<string, string> = {
    'X-Tenant-Id': opts.tenantId,
  };
  if (opts.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${opts.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  return resend.emails.send({
    from: `${opts.senderName} <${opts.senderEmail}>`,
    to: opts.to,
    subject: opts.subject,
    html,
    headers,
    reply_to: opts.replyTo,
  });
}

export async function sendBulkEmails(
  emails: SendEmailOptions[],
  batchSize = 100
) {
  const results = [];
  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(sendEmail));
    results.push(...batchResults);
  }
  return results;
}
