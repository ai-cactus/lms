/**
 * Regression guards for the transcode-worker's Prisma dependency chain.
 *
 * Bug 1 — "Cannot find module '.prisma/client/default'" production crash.
 *
 * Root cause: the schema only had `generator client { provider = "prisma-client" }`, which
 * outputs TypeScript to `generated/prisma` but does NOT emit a CJS client to
 * `node_modules/.prisma/client`. scripts/transcode-worker.mjs uses createRequire to load
 * `@prisma/client` as CJS; that package internally requires `.prisma/client/default` via
 * `require('#main-entry-point')` — so the worker crashed at startup with MODULE_NOT_FOUND
 * before doing any useful work.
 *
 * Fix: `generator worker_client { provider = "prisma-client-js" }` was added to
 * prisma/schema.prisma, which generates the legacy CJS client to node_modules/.prisma/client.
 *
 * Bug 2 — `PrismaClientInitializationError` when `new PrismaClient()` is called without adapter.
 *
 * Root cause: Prisma 7.8 in this project has no query-engine binary and connects exclusively
 * via the pg driver adapter. Calling `new PrismaClient()` (no args) throws synchronously with
 * PrismaClientInitializationError. The worker must mirror db/index.ts and pass the adapter:
 *   const { PrismaPg } = require('@prisma/adapter-pg');
 *   const prismaAdapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
 *   const prisma = new PrismaClient({ adapter: prismaAdapter });
 *
 * DO NOT REMOVE either test — together they guard the startup crash sequence that would prevent
 * the worker child process from doing any transcoding work.
 */
import { createRequire } from 'module';
import { describe, it, expect, afterEach } from 'vitest';

describe('transcode-worker Prisma CJS dependency [Bug 1 regression]', () => {
  it('resolves @prisma/client via createRequire and exposes PrismaClient as a constructor function', () => {
    // Mirrors the exact require pattern used in scripts/transcode-worker.mjs:
    //   const require = createRequire(import.meta.url);
    //   const { PrismaClient } = require('@prisma/client');
    //
    // This line fails with MODULE_NOT_FOUND when node_modules/.prisma/client is absent —
    // i.e. when prisma/schema.prisma has no `generator worker_client { provider = "prisma-client-js" }`
    // block, or when `prisma generate` has not been run after adding it.
    const req = createRequire(import.meta.url);

    // Should not throw MODULE_NOT_FOUND or any other resolution error.
    const clientModule = req('@prisma/client') as Record<string, unknown>;

    // PrismaClient must be a constructor function — the worker calls `new PrismaClient()`
    // at module level immediately after this require.
    expect(typeof clientModule.PrismaClient).toBe('function');
  });
});

describe('transcode-worker Prisma adapter construction [Bug 2 regression]', () => {
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
    // is safe to run offline in CI.
    process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/db';

    // Mirrors the exact pattern now used in scripts/transcode-worker.mjs:
    //   const { PrismaPg } = require('@prisma/adapter-pg');
    //   const { PrismaClient } = require('@prisma/client');
    //   const prismaAdapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    //   const prisma = new PrismaClient({ adapter: prismaAdapter });
    //
    // Bug 2 regression: a bare `new PrismaClient()` (no adapter) throws
    // PrismaClientInitializationError synchronously in Prisma 7.8 because there is
    // no query-engine binary — only the pg driver adapter is supported.
    const req = createRequire(import.meta.url);
    const { PrismaPg } = req('@prisma/adapter-pg') as { PrismaPg: new (opts: { connectionString: string }) => unknown };
    const { PrismaClient } = req('@prisma/client') as {
      PrismaClient: new (opts: { adapter: unknown }) => {
        lesson: { update: unknown };
        course: { update: unknown };
      };
    };

    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

    // Construction must NOT throw even though the database is unreachable —
    // PrismaPg defers the actual TCP connection until the first query.
    const prisma = new PrismaClient({ adapter });

    // The worker calls prisma.lesson.update(...) and prisma.course.update(...)
    // at runtime — both must be present as callable methods on the constructed client.
    expect(typeof prisma.lesson.update).toBe('function');
    expect(typeof prisma.course.update).toBe('function');
  });

  it('bare new PrismaClient() without adapter throws PrismaClientInitializationError synchronously', () => {
    // Documents the requirement enforced by Bug 2: if someone removes the adapter
    // from the worker's construction call, Prisma 7.8 rejects it immediately.
    // This test is only included because the throw is confirmed synchronous at
    // construction time; if that behavior ever changes, this assertion should be removed
    // rather than replaced with an async/lazy assertion.
    process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/db';

    const req = createRequire(import.meta.url);
    const { PrismaClient } = req('@prisma/client') as {
      PrismaClient: new () => unknown;
    };

    expect(() => new PrismaClient()).toThrow(/PrismaClientInitializationError|needs to be constructed with/);
  });
});
