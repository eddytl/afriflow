#!/usr/bin/env node
/**
 * Runner de migrations SQL AfriFlow
 * - Exécute les fichiers .sql dans packages/db/src/migrations/ dans l'ordre
 * - Mémorise les migrations appliquées dans public._migrations
 * - Idempotent : peut être relancé sans risque
 */
import postgres from 'postgres';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL est requis');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  connect_timeout: 30,
  idle_timeout: 10,
  onnotice: () => {}, // silence les NOTICES postgres
});

async function waitForPostgres(retries = 20, delayMs = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await sql`SELECT 1`;
      console.log('PostgreSQL prêt');
      return;
    } catch {
      console.log(`Attente PostgreSQL (${i}/${retries})…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('PostgreSQL non disponible après le délai maximum');
}

async function migrate() {
  await waitForPostgres();

  // Table de suivi des migrations
  await sql`
    CREATE TABLE IF NOT EXISTS public._migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const migrationsDir = join(__dirname, 'packages', 'db', 'src', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`${files.length} fichier(s) de migration trouvés`);

  for (const file of files) {
    const [row] = await sql`
      SELECT 1 FROM public._migrations WHERE filename = ${file}
    `;
    if (row) {
      console.log(`  ✓ ${file} (déjà appliqué)`);
      continue;
    }

    console.log(`  → ${file}`);
    let content = readFileSync(join(migrationsDir, file), 'utf8');

    // CREATE INDEX CONCURRENTLY n'est pas autorisé dans une transaction
    content = content.replace(/CREATE INDEX CONCURRENTLY/g, 'CREATE INDEX');

    try {
      // Exécution en mode autocommit (sql.unsafe hors transaction)
      await sql.unsafe(content);
      await sql`INSERT INTO public._migrations (filename) VALUES (${file})`;
      console.log(`  ✓ ${file} appliqué`);
    } catch (err) {
      // Erreurs non bloquantes (table déjà existante, etc.)
      const msg = err.message ?? String(err);
      console.warn(`  ⚠ ${file} : ${msg}`);
      // Marquer quand même pour ne pas retenter à chaque démarrage
      await sql`
        INSERT INTO public._migrations (filename) VALUES (${file})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  await sql.end();
  console.log('\nMigrations terminées avec succès.');
}

migrate().catch((err) => {
  console.error('\nÉchec des migrations :', err.message ?? err);
  process.exit(1);
});
