import { Worker, type Job } from 'bullmq';
import { redis, bullmqConnection } from '../lib/redis.js';
import { sql } from '../lib/db.js';
import { parse } from 'csv-parse/sync';

interface ImportJob {
  csv: string;
  tenantId: string;
}

export function createImportWorker() {
  const worker = new Worker<ImportJob>('import', async (job: Job<ImportJob>) => {
    const { csv, tenantId } = job.data;
    const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
    await sql.unsafe(`SET search_path = "${schemaName}", public`);

    const records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];

    const BATCH = 500;
    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const validRows = batch.filter((r) => r.email || r.phone);

      for (const row of validRows) {
        try {
          await sql`
            INSERT INTO contacts (email, phone, whatsapp, first_name, last_name, country)
            VALUES (
              ${row.email ?? null},
              ${row.phone ?? null},
              ${row.whatsapp ?? null},
              ${row.first_name ?? row.firstName ?? null},
              ${row.last_name ?? row.lastName ?? null},
              ${row.country ?? null}
            )
            ON CONFLICT (email) DO NOTHING
          `;
          inserted++;
        } catch {
          skipped++;
        }
      }
    }

    await job.updateProgress(100);
    return { inserted, skipped, total: records.length };
  }, {
    connection: bullmqConnection,
    concurrency: 2,
  });

  worker.on('failed', (job, err) => {
    console.error(`[ImportWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
