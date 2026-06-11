import { Queue } from 'bullmq';
import { bullmqConnection } from './redis.js';

const connection = bullmqConnection;

export const emailQueue = new Queue('email', { connection });
export const smsQueue = new Queue('sms', { connection });
export const whatsappQueue = new Queue('whatsapp', { connection });
export const automationQueue = new Queue('automation', { connection });
export const paymentQueue = new Queue('payment', { connection });
export const importQueue = new Queue('import', { connection });

export const QUEUES = {
  email: emailQueue,
  sms: smsQueue,
  whatsapp: whatsappQueue,
  automation: automationQueue,
  payment: paymentQueue,
  import: importQueue,
} as const;
