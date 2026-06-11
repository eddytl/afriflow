import { automationQueue } from '../lib/queue.js';
import { createAutomationWorker } from './automation.worker.js';
import { createEmailWorker } from './email.worker.js';
import { createSmsWorker } from './sms.worker.js';
import { createWhatsAppWorker } from './whatsapp.worker.js';
import { createPaymentWorker } from './payment.worker.js';
import { createImportWorker } from './import.worker.js';
import { funnelRulesWorker } from './funnel-rules.worker.js';
import { globalRulesWorker } from './global-rules.worker.js';

export async function startWorkers() {
  createAutomationWorker();
  createEmailWorker();
  createSmsWorker();
  createWhatsAppWorker();
  createPaymentWorker();
  createImportWorker();
  // Ces workers démarrent automatiquement à l'import (new Worker(...))
  void funnelRulesWorker;
  void globalRulesWorker;

  // Tick automation toutes les 60 secondes
  await automationQueue.add(
    'tick',
    {},
    {
      repeat: { every: 60_000 },
      jobId: 'automation-tick', // évite les doublons au redémarrage
    }
  );

  console.info('[Workers] All workers started');
}
