import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@afriflow/db';

const queryClient = postgres(process.env.DATABASE_URL!, {
  max:             50,  // 20→50 : capacité pour ~200 requêtes concurrentes (4 requêtes/conn en moyenne)
  idle_timeout:    30,
  connect_timeout: 10,
  max_lifetime:    1800, // recycler les connexions après 30 min (évite les connexions "zombies")
});

export const db = drizzle(queryClient, { schema });
export { queryClient as sql };

export function tenantSchemaName(tenantId: string): string {
  return `tenant_${tenantId.replace(/-/g, '_')}`;
}

// Run fn inside a transaction pinned to one connection with the correct search_path.
// Use this for ALL writes (INSERT/UPDATE/DELETE) in tenant routes.
export function withTenant<T>(
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>
): Promise<T> {
  const schemaName = tenantSchemaName(tenantId);
  return queryClient.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL search_path = "${schemaName}", public`);
    return fn(tx);
  }) as Promise<T>;
}
