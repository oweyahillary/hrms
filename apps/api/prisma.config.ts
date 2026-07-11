// Prisma 7 configuration. The connection URL lives here (used by the Prisma
// CLI for migrations / generate) instead of in schema.prisma. At runtime the
// application passes the same URL to the pg driver adapter (see prisma.service.ts).
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
