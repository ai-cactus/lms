/**
 * Tests the exact Prisma $executeRaw vector update used by the indexer.
 *
 * Run (local: export an env file first; on a server: npm run script <staging|production> <file>):
 *   npx tsx scripts/test-vector-upsert.ts
 */
import { prisma } from '@/db/index';

function errInfo(e: unknown): { name: string; message: string; code?: string; meta?: unknown } {
  if (e instanceof Error) {
    const withExtra = e as Error & { code?: string; meta?: unknown };
    return { name: e.name, message: e.message, code: withExtra.code, meta: withExtra.meta };
  }
  return { name: 'Error', message: String(e) };
}

const fakeEmbedding = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.1).toFixed(6));
const embeddingString = `[${fakeEmbedding.join(',')}]`;

console.log(`\nEmbedding string length: ${embeddingString.length} chars`);
console.log(`First 60 chars: ${embeddingString.slice(0, 60)}...`);

async function run() {
  const manual = await prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!manual) {
    console.error('\n✗ No active manual in DB');
    return;
  }
  console.log(`\nUsing manual: ${manual.filename} (${manual.id})`);

  console.log('\n─── Step 1: Create ManualChunk record...');
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
    console.log(`✓ Created chunk: ${chunk.id}`);
  } catch (err) {
    const info = errInfo(err);
    console.error('✗ manualChunk.create FAILED:', info.message);
    console.error('  code:', info.code);
    return;
  }

  console.log('\n─── Step 2A: $executeRaw tagged template...');
  try {
    const result = await prisma.$executeRaw`
      UPDATE "ManualChunk"
      SET embedding = ${embeddingString}::vector
      WHERE id = ${chunk.id}
    `;
    console.log(`✓ Tagged template OK — rows affected: ${result}`);
  } catch (err) {
    const info = errInfo(err);
    console.error('✗ Tagged template FAILED:');
    console.error('  name   :', info.name);
    console.error('  message:', info.message);
    console.error('  code   :', info.code);
    console.error('  meta   :', JSON.stringify(info.meta));

    console.log('\n─── Step 2B: $executeRawUnsafe...');
    try {
      const result2 = await prisma.$executeRawUnsafe(
        `UPDATE "ManualChunk" SET embedding = '${embeddingString}'::vector WHERE id = $1`,
        chunk.id,
      );
      console.log(`✓ $executeRawUnsafe OK — rows affected: ${result2}`);
    } catch (err2) {
      const info2 = errInfo(err2);
      console.error('✗ $executeRawUnsafe FAILED:');
      console.error('  name   :', info2.name);
      console.error('  message:', info2.message);
      console.error('  code   :', info2.code);
    }
  }

  console.log('\n─── Step 3: Verify embedding stored...');
  try {
    const rows = await prisma.$queryRaw`
      SELECT id, (embedding IS NOT NULL) as has_embedding,
             array_length(embedding::text::varchar[], 1) as dims
      FROM "ManualChunk" WHERE id = ${chunk.id}
    `;
    console.log('Query result:', JSON.stringify(rows));
  } catch {
    try {
      const rows2 = await prisma.$queryRawUnsafe(
        `SELECT id, (embedding IS NOT NULL) as has_embedding FROM "ManualChunk" WHERE id = $1`,
        chunk.id,
      );
      console.log('Check result:', JSON.stringify(rows2));
    } catch (e2) {
      console.error('✗ Verify query failed:', errInfo(e2).message);
    }
  }

  console.log('\n─── Step 4: Cleaning up test chunk...');
  try {
    await prisma.manualChunk.delete({ where: { id: chunk.id } });
    console.log('✓ Cleaned up');
  } catch (err) {
    console.warn('⚠ Cleanup failed (not critical):', errInfo(err).message);
  }

  await prisma.$disconnect();
  console.log('\n─── Vector upsert test complete ─────────────────────\n');
}

run().catch((err) => {
  const info = errInfo(err);
  console.error('\nFatal:', info.name, info.message);
  if (err instanceof Error) console.error(err.stack);
  process.exit(1);
});
