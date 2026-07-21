/**
 * Regression guards for the transcode-worker's Prisma dependency chain.
 *
 * Architecture: the queue workers (scripts/transcode-worker.ts and
 * scripts/index-worker.ts) run via `node --import tsx` and import the SAME
 * Prisma singleton the app uses — `import { prisma } from '@/db/index'`, which
 * builds a `PrismaClient` from `@/generated/prisma/client` with a `PrismaPg`
 * driver adapter. There is no longer a legacy CJS `@prisma/client` /
 * `.prisma/client` client in play (the `worker_client` generator was removed).
 *
 * These tests guard that dependency chain:
 *   1. The generated client + pg adapter construct offline without connecting,
 *      and expose the `lesson.update` / `course.update` methods the worker calls.
 *   2. A bare `new PrismaClient()` (no adapter) throws synchronously — Prisma 7.8
 *      has no query-engine binary and requires the driver adapter. This documents
 *      the requirement db/index.ts satisfies; if the worker (or db/index) ever
 *      dropped the adapter, the workers would crash at startup.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

describe('worker Prisma dependency chain [regression]', () => {
  // Save and restore DATABASE_URL so the fake URL does not leak into other tests.
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('constructs PrismaClient WITH the pg adapter without connecting and exposes lesson and course update methods', () => {
    // Use a syntactically valid URL that won't connect (port 1 is closed).
    // PrismaPg does not open a connection until the first query — so construction
    // is safe to run offline in CI. Mirrors db/index.ts, which the workers share.
    const adapter = new PrismaPg({ connectionString: 'postgresql://u:p@127.0.0.1:1/db' });

    // Construction must NOT throw even though the database is unreachable —
    // PrismaPg defers the actual TCP connection until the first query.
    const prisma = new PrismaClient({ adapter });

    // The worker calls prisma.lesson.update(...) and prisma.course.update(...)
    // at runtime — both must be present as callable methods on the constructed client.
    expect(typeof prisma.lesson.update).toBe('function');
    expect(typeof prisma.course.update).toBe('function');
  });

  it('bare new PrismaClient() without adapter throws PrismaClientInitializationError synchronously', () => {
    // Prisma 7.x rejects a bare construction immediately because there is no
    // query-engine binary — only the pg driver adapter is supported. This throw
    // is confirmed synchronous at construction time; if that behavior ever
    // changes, this assertion should be removed rather than made async/lazy.
    // The generated client's type also requires the adapter arg — the runtime
    // throw is exactly what we assert here, so bypass the compile-time check.
    // The message wording varies across 7.x minors (7.9 reworded it), so match
    // the stable "adapter is required" intent rather than one exact phrasing.
    // @ts-expect-error - intentionally omitting the required adapter to prove it throws
    expect(() => new PrismaClient()).toThrow(
      /PrismaClientInitializationError|needs to be constructed with|driver adapter is required/,
    );
  });
});
