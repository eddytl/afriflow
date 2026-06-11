import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/schema/public.ts', './src/schema/tenant.ts'],
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
