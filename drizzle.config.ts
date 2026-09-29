import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/adapters/postgres/schema.ts',
  out: './supabase/migrations',
  migrations: { prefix: 'supabase' },
});
