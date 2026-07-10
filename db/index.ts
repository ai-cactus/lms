import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * Single Prisma client for the whole app.
 *
 * Why a global singleton: in dev, Next.js HMR re-executes modules on every
 * edit. Without caching the client on `globalThis`, each reload would build a
 * fresh `PrismaPg` pool and leak connections until Postgres refuses new ones.
 * In production the module is evaluated once, so the cache is a no-op there.
 */

// Max connections the pool may open. Keep well under Postgres `max_connections`
// (and, behind PgBouncer, the pooler's own limit). Defaults to 10.
const poolMax = Number(process.env.DATABASE_POOL_MAX) || 10;

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // Pool sizing.
    max: poolMax,
    // Release a connection back to Postgres after 30s idle so we don't pin
    // connections the app isn't using.
    idleTimeoutMillis: 30_000,
    // Fail fast (10s) when the pool is exhausted or the DB is unreachable
    // instead of hanging the request indefinitely.
    connectionTimeoutMillis: 10_000,
    // Server-side guard against runaway queries. Generous (60s) so normal
    // sub-second queries and heavier reporting/aggregation still complete,
    // while a truly stuck statement can't hold a connection forever.
    statement_timeout: 60_000,
    // Client-side backstop mirroring statement_timeout in case the server
    // never enforces it (e.g. connection dropped mid-query).
    query_timeout: 60_000,
  });

  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
