import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as publicSchema from './schema/public.js';
import * as tenantSchema from './schema/tenant.js';

const sql = postgres(process.env.DATABASE_URL!, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(sql, {
  schema: { ...publicSchema, ...tenantSchema },
});

export { sql };
export type DB = typeof db;

// Tenant migration files in order (skip 0000 which is public-schema only)
const TENANT_MIGRATIONS = [
  '0001_init_tenant_schema.sql',
  '0002_crm_calendar_affiliate.sql',
  '0003_sites.sql',
  '0004_funnel_automation_rules.sql',
  '0005_sms_module.sql',
  '0006_automation_rules_workflows.sql',
  '0007_resources.sql',
  '0008_sales.sql',
  '0009_email_module.sql',
  '0010_settings_module.sql',
  '0011_totp.sql',
  '0012_perf_indexes.sql',
];

export async function createTenantSchema(tenantId: string): Promise<void> {
  const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;

  // CREATE SCHEMA must run outside the transaction (DDL on the schema itself)
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

  // Run all tenant migrations in a single transaction on one connection
  // SET LOCAL search_path is scoped to this transaction automatically
  await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL search_path = "${schemaName}", public`);

    const fs = await import('fs');
    const path = await import('path');
    const migrationsDir = path.join(import.meta.dirname, 'migrations');

    for (const file of TENANT_MIGRATIONS) {
      const migrationSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await tx.unsafe(migrationSql);
    }
  });
}

// Used by route handlers — fn receives a sql instance pinned to one connection
// with the tenant's search_path set for the duration of the transaction.
export function withTenantSchema<T>(
  tenantId: string,
  fn: (sql: postgres.TransactionSql) => Promise<T>
): Promise<T> {
  const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL search_path = "${schemaName}", public`);
    return fn(tx);
  }) as Promise<T>;
}
