import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/',
  migrations: {
    path: 'prisma/migrations',
    // Run by `npx prisma db seed` (e.g. to populate the e2e test database).
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
