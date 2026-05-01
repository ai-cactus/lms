#!/usr/bin/env node
/**
 * Tests the exact Prisma $executeRaw vector update used by the indexer.
 * Run: node scripts/test-vector-upsert.mjs
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';
const require = createRequire(import.meta.url);

// Load .env
try {
  const lines = readFileSync(resolve(process.cwd(), '.env'), 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
  console.log('✓ .env loaded');
} catch { console.warn('⚠ No .env'); }

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Generate a fake 768-dim embedding
const fakeEmbedding = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.1).toFixed(6));
const embeddingString = `[${fakeEmbedding.join(',')}]`;

console.log(`\nEmbedding string length: ${embeddingString.length} chars`);
console.log(`First 60 chars: ${embeddingString.slice(0, 60)}...`);

async function run() {
  // 1. Find the active manual
  const manual = await prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!manual) { console.error('\n✗ No active manual in DB'); return; }
  console.log(`\nUsing manual: ${manual.filename} (${manual.id})`);

  // 2. Create a test chunk
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
    console.error('✗ manualChunk.create FAILED:', err.message);
    console.error('  code:', err.code);
    return;
  }

  // 3. Try the $executeRaw vector update (Approach A — tagged template)
  console.log('\n─── Step 2A: $executeRaw tagged template...');
  try {
    const result = await prisma.$executeRaw`
      UPDATE "ManualChunk"
      SET embedding = ${embeddingString}::vector
      WHERE id = ${chunk.id}
    `;
    console.log(`✓ Tagged template OK — rows affected: ${result}`);
  } catch (err) {
    console.error('✗ Tagged template FAILED:');
    console.error('  name   :', err.name);
    console.error('  message:', err.message);
    console.error('  code   :', err.code);
    console.error('  meta   :', JSON.stringify(err.meta));

    // Try Approach B — $executeRawUnsafe
    console.log('\n─── Step 2B: $executeRawUnsafe...');
    try {
      const result2 = await prisma.$executeRawUnsafe(
        `UPDATE "ManualChunk" SET embedding = '${embeddingString}'::vector WHERE id = $1`,
        chunk.id,
      );
      console.log(`✓ $executeRawUnsafe OK — rows affected: ${result2}`);
    } catch (err2) {
      console.error('✗ $executeRawUnsafe FAILED:');
      console.error('  name   :', err2.name);
      console.error('  message:', err2.message);
      console.error('  code   :', err2.code);
    }
  }

  // 4. Verify the embedding was stored
  console.log('\n─── Step 3: Verify embedding stored...');
  try {
    const rows = await prisma.$queryRaw`
      SELECT id, (embedding IS NOT NULL) as has_embedding,
             array_length(embedding::text::varchar[], 1) as dims
      FROM "ManualChunk" WHERE id = ${chunk.id}
    `;
    console.log('Query result:', JSON.stringify(rows));
  } catch (err) {
    // Simpler check
    try {
      const rows2 = await prisma.$queryRawUnsafe(
        `SELECT id, (embedding IS NOT NULL) as has_embedding FROM "ManualChunk" WHERE id = $1`,
        chunk.id,
      );
      console.log('Check result:', JSON.stringify(rows2));
    } catch (e2) {
      console.error('✗ Verify query failed:', e2.message);
    }
  }

  // 5. Clean up test chunk
  console.log('\n─── Step 4: Cleaning up test chunk...');
  try {
    await prisma.manualChunk.delete({ where: { id: chunk.id } });
    console.log('✓ Cleaned up');
  } catch (err) {
    console.warn('⚠ Cleanup failed (not critical):', err.message);
  }

  await prisma.$disconnect();
  console.log('\n─── Vector upsert test complete ─────────────────────\n');
}

run().catch(err => {
  console.error('\nFatal:', err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});
