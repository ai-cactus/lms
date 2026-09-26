import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { liveRowsOnly } from './archive-filter';

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

const baseClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = baseClient;

/**
 * Q24 archive filter, as ONE predicate rather than 47 call sites.
 *
 * Deleting a course or a document archives it (`archivedAt`) instead of
 * destroying it, so every ordinary read has to exclude archived rows. Expressing
 * that per call site is the exact pattern that produced the D-01 defect class
 * here — see the header of `src/lib/facility/staff-where.ts`, which exists
 * because "facility scoping was expressed ad hoc at each call site — or not at
 * all". A query extension applies it once, to every top-level read, with no
 * call-site change and no way to forget it on the next one.
 *
 * ⚠️ Writes are deliberately NOT intercepted. Rerouting `.delete()` to an
 * archive `.update()` would make `deleteCourse`/`deleteDocument`'s intent
 * invisible at the call site; both call `.update()` explicitly instead.
 *
 * ⚠️ A query extension cannot reach nested `include`/`select` — mutating those
 * would change the output type, which Prisma forbids. So a traversal INTO
 * Course/Document from another model is unfiltered. Every such relation is
 * to-one (`Enrollment.course`, `Certificate.course`, `CourseAssignment.course`,
 * `CourseVersion.documentVersion.document`), where Prisma has no `where` to
 * begin with — and where leaving archived rows visible is the ruling anyway: a
 * worker's own enrolment and certificate survive their course being archived.
 * The only to-many traversals (`OrganizationUser.createdCourses` /
 * `.documents`) are in the `/system` ops panel, which is meant to see
 * everything.
 */
export const prisma = baseClient.$extends({
  query: {
    course: {
      findFirst: ({ args, query }) => query(liveRowsOnly(args)),
      findFirstOrThrow: ({ args, query }) => query(liveRowsOnly(args)),
      findMany: ({ args, query }) => query(liveRowsOnly(args)),
      findUnique: ({ args, query }) => query(liveRowsOnly(args)),
      findUniqueOrThrow: ({ args, query }) => query(liveRowsOnly(args)),
      count: ({ args, query }) => query(liveRowsOnly(args)),
      aggregate: ({ args, query }) => query(liveRowsOnly(args)),
      groupBy: ({ args, query }) => query(liveRowsOnly(args)),
    },
    document: {
      findFirst: ({ args, query }) => query(liveRowsOnly(args)),
      findFirstOrThrow: ({ args, query }) => query(liveRowsOnly(args)),
      findMany: ({ args, query }) => query(liveRowsOnly(args)),
      findUnique: ({ args, query }) => query(liveRowsOnly(args)),
      findUniqueOrThrow: ({ args, query }) => query(liveRowsOnly(args)),
      count: ({ args, query }) => query(liveRowsOnly(args)),
      aggregate: ({ args, query }) => query(liveRowsOnly(args)),
      groupBy: ({ args, query }) => query(liveRowsOnly(args)),
    },
  },
});

/** The app's Prisma client, archive filter included. */
export type DbClient = typeof prisma;

/**
 * The client handed to a `prisma.$transaction(async (tx) => …)` callback.
 *
 * `Prisma.TransactionClient` describes the UN-extended client and an extended
 * one does not satisfy it (prisma/prisma#20738 — a typing gap only; the
 * extension itself does apply inside interactive transactions, verified against
 * 7.10.0). Helpers that accept "a client or a transaction" must be typed off the
 * real client, or every extended `tx` they are handed fails to typecheck.
 */
export type DbTransactionClient = Parameters<Parameters<DbClient['$transaction']>[0]>[0];

/**
 * ⛔ The SAME connection pool, WITHOUT the archive filter. Archived courses and
 * documents come back from this client.
 *
 * Importing this is very likely a bug. It exists for the handful of paths whose
 * correctness depends on seeing retained rows:
 *
 *   1. `video-sweep-worker.ts` — builds the "do not delete this object" storage
 *      reference set. Filtered, an archived course's video drops out of that set
 *      and the sweeper permanently deletes a file Q24 says must be retained.
 *      This repo has already lost production videos twice.
 *   2. `auditor-export-worker.ts` — a compliance export that silently omits
 *      archived courses is incomplete while still looking correct.
 *   3. `actions/auditor.ts` and `api/auditor/export/start/route.ts` — the
 *      auditor's on-screen CATALOGUE, kept in step with the export above. An
 *      auditor seeing one course count on screen and a different one in the
 *      record they download undermines the artifact. These widen the Course row
 *      ONLY: the `auditPack.*` gates and the facility narrowing on every
 *      enrollment/staff query around them are untouched.
 *   4. `system-admin.ts` — the user-deletion impact preview must count what the
 *      hard delete will actually destroy, and the delete itself must resolve the
 *      same rows it is about to remove.
 *   5. `get-learn-payload.ts` and 6. `actions/course.ts::getCourseById` — the
 *      learn player and the entry point that fronts it. Both read unfiltered so
 *      that an archived course can be REFUSED with the right answer: founder
 *      Q-04/Q-05 (2026-09-23) made archiving a cancellation for learners, so
 *      each states its own refusal immediately after the lookup, and the player
 *      can say the course was cancelled rather than report it missing. Nothing
 *      else in `course.ts` is widened; the course LISTS stay on the filtered
 *      client.
 *
 * Anywhere else, use `prisma`.
 */
export const rawPrisma = baseClient;
