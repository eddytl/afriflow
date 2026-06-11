import { buildApp } from './app.js';
import { redis } from './lib/redis.js';
import { startWorkers } from './workers/index.js';
import { sql as pgSql } from './lib/db.js';
import { createTenantSchema } from '@afriflow/db';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = '0.0.0.0';

async function runTenantMigrations(): Promise<void> {
  try {
    const tenants = await pgSql<{ id: string }[]>`SELECT id FROM public.tenants`;
    for (const t of tenants) {
      await createTenantSchema(t.id);
    }
    console.log(`[migrations] Applied tenant migrations to ${tenants.length} tenant(s)`);
  } catch (err) {
    console.error('[migrations] Failed to run tenant migrations:', err);
  }
}

async function main() {
  const app = await buildApp();

  await redis.connect();
  await runTenantMigrations();
  await startWorkers();

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`AfriFlow API running on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
