import { Worker, type Job } from 'bullmq';
import { redis, bullmqConnection } from '../lib/redis.js';
import { sql } from '../lib/db.js';
import { emailQueue, smsQueue, whatsappQueue } from '../lib/queue.js';

interface Enrollment {
  id: string;
  automation_id: string;
  contact_id: string;
  current_step: number;
  context: Record<string, unknown>;
  status: string;
}

interface AutomationStep {
  id: number;
  type: string;
  params: Record<string, unknown>;
  nextStep?: number | null;
  trueStep?: number | null;
  falseStep?: number | null;
}

async function processEnrollment(enrollment: Enrollment): Promise<void> {
  const [automation] = await sql<{ steps: AutomationStep[]; status: string }[]>`
    SELECT steps, status FROM automations WHERE id = ${enrollment.automation_id}
  `;
  if (!automation || automation.status !== 'active') {
    await sql`UPDATE automation_enrollments SET status = 'exited' WHERE id = ${enrollment.id}`;
    return;
  }

  const steps: AutomationStep[] = automation.steps;
  const step = steps[enrollment.current_step];
  if (!step) {
    await sql`UPDATE automation_enrollments SET status = 'completed' WHERE id = ${enrollment.id}`;
    return;
  }

  const [contact] = await sql`SELECT * FROM contacts WHERE id = ${enrollment.contact_id}`;

  switch (step.type) {
    case 'send_email':
      await emailQueue.add('automation-email', {
        contactId: enrollment.contact_id,
        enrollmentId: enrollment.id,
        templateId: step.params.templateId,
        subject: step.params.subject,
        body: step.params.body,
      });
      break;

    case 'send_sms':
      await smsQueue.add('automation-sms', {
        contactId: enrollment.contact_id,
        phone: contact?.phone,
        message: step.params.message,
        country: contact?.country,
      });
      break;

    case 'send_whatsapp':
      await whatsappQueue.add('automation-wa', {
        phone: contact?.whatsapp ?? contact?.phone,
        templateName: step.params.templateName,
        variables: step.params.variables ?? [],
      });
      break;

    case 'wait': {
      const days = Number(step.params.days ?? 0);
      const hours = Number(step.params.hours ?? 0);
      const minutes = Number(step.params.minutes ?? 0);
      const nextRunAt = new Date(
        Date.now() + (days * 86_400_000) + (hours * 3_600_000) + (minutes * 60_000)
      );
      await sql`
        UPDATE automation_enrollments
        SET next_run_at = ${nextRunAt.toISOString()}, current_step = ${enrollment.current_step + 1}
        WHERE id = ${enrollment.id}
      `;
      return;
    }

    case 'condition': {
      const { field, operator, value } = step.params;
      const ok = evaluateCondition(contact, field as string, operator as string, value);
      const nextStep = ok ? step.trueStep : step.falseStep;
      if (nextStep == null) {
        await sql`UPDATE automation_enrollments SET status = 'completed' WHERE id = ${enrollment.id}`;
        return;
      }
      await sql`
        UPDATE automation_enrollments SET current_step = ${nextStep}, next_run_at = now()
        WHERE id = ${enrollment.id}
      `;
      return;
    }

    case 'add_tag':
      await sql`
        UPDATE contacts
        SET tags = array(SELECT DISTINCT unnest(array_cat(tags, ARRAY[${step.params.tag as string}])))
        WHERE id = ${enrollment.contact_id}
      `;
      break;

    case 'remove_tag':
      await sql`
        UPDATE contacts
        SET tags = array_remove(tags, ${step.params.tag as string})
        WHERE id = ${enrollment.contact_id}
      `;
      break;

    case 'wait_for_event':
      await sql`
        UPDATE automation_enrollments
        SET status = 'waiting_event', context = ${JSON.stringify({ ...enrollment.context, waitingFor: step.params.event })}::jsonb
        WHERE id = ${enrollment.id}
      `;
      return;

    case 'exit_if': {
      const { field, operator, value } = step.params;
      if (evaluateCondition(contact, field as string, operator as string, value)) {
        await sql`UPDATE automation_enrollments SET status = 'exited' WHERE id = ${enrollment.id}`;
        return;
      }
      break;
    }
  }

  // Avancer au step suivant
  const nextStep = step.nextStep ?? enrollment.current_step + 1;
  if (nextStep >= steps.length) {
    await sql`UPDATE automation_enrollments SET status = 'completed' WHERE id = ${enrollment.id}`;
  } else {
    await sql`
      UPDATE automation_enrollments SET current_step = ${nextStep}, next_run_at = now()
      WHERE id = ${enrollment.id}
    `;
  }
}

function evaluateCondition(
  contact: Record<string, unknown> | undefined,
  field: string,
  operator: string,
  value: unknown
): boolean {
  if (!contact) return false;
  const fieldValue = contact[field];
  switch (operator) {
    case 'equals': return fieldValue === value;
    case 'not_equals': return fieldValue !== value;
    case 'greater_than': return Number(fieldValue) > Number(value);
    case 'less_than': return Number(fieldValue) < Number(value);
    case 'contains': return Array.isArray(fieldValue) ? fieldValue.includes(value) : String(fieldValue).includes(String(value));
    case 'within_days': {
      if (!fieldValue) return false;
      const daysAgo = new Date(Date.now() - Number(value) * 86_400_000);
      return new Date(fieldValue as string) >= daysAgo;
    }
    default: return false;
  }
}

export function createAutomationWorker() {
  const worker = new Worker('automation', async (_job: Job) => {
    // Récupérer tous les enrollments dus
    const due = await sql<Enrollment[]>`
      SELECT * FROM automation_enrollments
      WHERE status = 'active' AND next_run_at <= now()
      LIMIT 500
      FOR UPDATE SKIP LOCKED
    `;

    await Promise.allSettled(due.map(processEnrollment));
  }, {
    connection: bullmqConnection,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    console.error(`[AutomationWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
