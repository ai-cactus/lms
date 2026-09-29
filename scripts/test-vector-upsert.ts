/**
 * Tests the exact Prisma $executeRaw vector update used by the indexer.
 *
 * Run (local: export an env file first; on a server: npm run script <staging|production> <file>):
 *   npx tsx scripts/test-vector-upsert.ts
 */
import { prisma } from '@/db/index';
import { logger } from '@/lib/logger';

function errInfo(e: unknown): { name: string; message: string; code?: string; meta?: unknown } {
  if (e instanceof Error) {
    const withExtra = e as Error & { code?: string; meta?: unknown };
    return { name: e.name, message: e.message, code: withExtra.code, meta: withExtra.meta };
  }
  return { name: 'Error', message: String(e) };
}

const fakeEmbedding = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.1).toFixed(6));
const embeddingString = `[${fakeEmbedding.join(',')}]`;

logger.info({
  msg: `[test-vector-upsert] Embedding string length: ${embeddingString.length} chars`,
});
logger.info({ msg: `[test-vector-upsert] First 60 chars: ${embeddingString.slice(0, 60)}...` });

async function run() {
  const manual = await prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!manual) {
    logger.error({ msg: '[test-vector-upsert] ✗ No active manual in DB' });
    return;
  }
  logger.info({ msg: `[test-vector-upsert] Using manual: ${manual.filename} (${manual.id})` });

  logger.info({ msg: '[test-vector-upsert] ─── Step 1: Create ManualChunk record...' });
  let chunk;
  try {
    chunk = await prisma.manualChunk.create({
      data: {
        manualId: manual.id,
        chunkIndex: 99999, // unlikely to collide
        pageNumber: null,
        content: 'TEST CHUNK — safe to delete',
      },
    });
    logger.info({ msg: `[test-vector-upsert] ✓ Created chunk: ${chunk.id}` });
  } catch (err) {
    const info = errInfo(err);
    logger.error({
      msg: '[test-vector-upsert] ✗ manualChunk.create FAILED',
      errMessage: info.message,
      code: info.code,
    });
    return;
  }

  logger.info({ msg: '[test-vector-upsert] ─── Step 2A: $executeRaw tagged template...' });
  try {
    const result = await prisma.$executeRaw`
      UPDATE "ManualChunk"
      SET embedding = ${embeddingString}::vector
      WHERE id = ${chunk.id}
    `;
    logger.info({ msg: `[test-vector-upsert] ✓ Tagged template OK — rows affected: ${result}` });
  } catch (err) {
    const info = errInfo(err);
    logger.error({
      msg: '[test-vector-upsert] ✗ Tagged template FAILED',
      errName: info.name,
      errMessage: info.message,
      code: info.code,
      meta: info.meta,
    });

    logger.info({ msg: '[test-vector-upsert] ─── Step 2B: $executeRawUnsafe...' });
    try {
      const result2 = await prisma.$executeRawUnsafe(
        `UPDATE "ManualChunk" SET embedding = '${embeddingString}'::vector WHERE id = $1`,
        chunk.id,
      );
      logger.info({
        msg: `[test-vector-upsert] ✓ $executeRawUnsafe OK — rows affected: ${result2}`,
      });
    } catch (err2) {
      const info2 = errInfo(err2);
      logger.error({
        msg: '[test-vector-upsert] ✗ $executeRawUnsafe FAILED',
        errName: info2.name,
        errMessage: info2.message,
        code: info2.code,
      });
    }
  }

  logger.info({ msg: '[test-vector-upsert] ─── Step 3: Verify embedding stored...' });
  try {
    const rows = await prisma.$queryRaw`
      SELECT id, (embedding IS NOT NULL) as has_embedding,
             array_length(embedding::text::varchar[], 1) as dims
      FROM "ManualChunk" WHERE id = ${chunk.id}
    `;
    logger.info({ msg: '[test-vector-upsert] Query result', rows });
  } catch {
    try {
      const rows2 = await prisma.$queryRawUnsafe(
        `SELECT id, (embedding IS NOT NULL) as has_embedding FROM "ManualChunk" WHERE id = $1`,
        chunk.id,
      );
      logger.info({ msg: '[test-vector-upsert] Check result', rows: rows2 });
    } catch (e2) {
      logger.error({
        msg: '[test-vector-upsert] ✗ Verify query failed',
        errMessage: errInfo(e2).message,
      });
    }
  }

  logger.info({ msg: '[test-vector-upsert] ─── Step 4: Cleaning up test chunk...' });
  try {
    await prisma.manualChunk.delete({ where: { id: chunk.id } });
    logger.info({ msg: '[test-vector-upsert] ✓ Cleaned up' });
  } catch (err) {
    logger.warn({
      msg: '[test-vector-upsert] ⚠ Cleanup failed (not critical)',
      errMessage: errInfo(err).message,
    });
  }

  await prisma.$disconnect();
  logger.info({
    msg: '[test-vector-upsert] ─── Vector upsert test complete ─────────────────────',
  });
}

run().catch((err) => {
  logger.error({ msg: '[test-vector-upsert] Fatal', err, code: errInfo(err).code });
  process.exit(1);
});
