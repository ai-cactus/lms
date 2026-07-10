/**
 * End-to-end test of the full indexing pipeline using pdftotext + batch embeddings.
 * Mirrors the exact code path the BullMQ worker takes.
 *
 * Run (local: export an env file first; on a server: npm run script <staging|production> <file>):
 *   npx tsx scripts/test-full-indexer.ts
 *
 * Tests the first 3 batches only (300 chunks) to validate correctness quickly.
 * Set TEST_ALL=1 to run the full indexing.
 */
import { writeFileSync, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Client as MinioClient } from 'minio';
import { GoogleAuth } from 'google-auth-library';
import { prisma } from '@/db/index';

const execFileAsync = promisify(execFile);

interface EmbeddingResponse {
  predictions: Array<{ embeddings: { values: number[] } }>;
}

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

const MINIO = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: parseInt(process.env.MINIO_PORT ?? '9005', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'lms_minio_dev',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'lms_minio_secret_dev',
});

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const MIN_LEN = 50;
const BATCH_SIZE = 100;
const PROJECT_ID = process.env.GOOGLE_PROJECT_ID || 'theraptly-lms';
const LOCATION = process.env.GOOGLE_LOCATION || 'us-central1';
const MODEL = 'text-embedding-004';
const TEST_ALL = process.env.TEST_ALL === '1';
const TEST_BATCHES = 3;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    if (end < text.length) {
      const w = text.substring(start, end);
      const lp = w.lastIndexOf('. ');
      if (lp > CHUNK_SIZE * 0.5) end = start + lp + 1;
    } else {
      end = text.length;
    }
    const t = text.substring(start, end).trim();
    if (t.length >= MIN_LEN) chunks.push(t);
    start = end > start ? end - CHUNK_OVERLAP : end;
  }
  return chunks;
}

async function extractText(buf: Buffer): Promise<string> {
  const id = randomUUID();
  const tmpPdf = join(tmpdir(), `test-${id}.pdf`);
  const tmpTxt = join(tmpdir(), `test-${id}.txt`);
  try {
    writeFileSync(tmpPdf, buf);
    await execFileAsync('pdftotext', ['-enc', 'UTF-8', '-nopgbrk', tmpPdf, tmpTxt]);
    return await readFile(tmpTxt, 'utf8');
  } finally {
    try {
      unlinkSync(tmpPdf);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(tmpTxt);
    } catch {
      /* ignore */
    }
  }
}

async function batchEmbed(texts: string[]): Promise<number[][]> {
  const token = await auth.getAccessToken();
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      instances: texts.map((t) => ({ task_type: 'RETRIEVAL_DOCUMENT', title: '', content: t })),
    }),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as EmbeddingResponse;
  return json.predictions.map((p) => p.embeddings.values);
}

async function run() {
  const manual = await prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!manual) {
    console.error('No active manual');
    return;
  }
  console.log(`\nManual: ${manual.filename} (${manual.id})`);

  console.log('\n─── Step 1: Download PDF...');
  const match = manual.storagePath.match(/^minio:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    console.error(`✗ Cannot parse storagePath: ${manual.storagePath}`);
    return;
  }
  const stream = await MINIO.getObject(match[1], match[2]);
  const bufChunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (d: Buffer) => bufChunks.push(d));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  const buf = Buffer.concat(bufChunks);
  console.log(
    `✓ ${buf.length} bytes | heap: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
  );

  console.log('\n─── Step 2: Extract text via pdftotext...');
  const t0 = Date.now();
  const text = await extractText(buf);
  console.log(
    `✓ ${text.length} chars in ${((Date.now() - t0) / 1000).toFixed(1)}s | heap: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
  );

  const allChunks = chunkText(text.trim());
  const limit = TEST_ALL ? allChunks.length : BATCH_SIZE * TEST_BATCHES;
  const chunks = allChunks.slice(0, limit);
  console.log(
    `\n─── Step 3: Chunks: ${allChunks.length} total, testing ${chunks.length} (${Math.ceil(chunks.length / BATCH_SIZE)} batches)...`,
  );

  await prisma.manualChunk.deleteMany({ where: { manualId: manual.id } });
  console.log('✓ Cleared existing chunks');

  // Batch embed + write
  let processed = 0,
    failed = 0;
  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const start = b * BATCH_SIZE;
    const batch = chunks.slice(start, start + BATCH_SIZE);
    const t1 = Date.now();
    try {
      const embeddings: (number[] | null)[] = await batchEmbed(batch);
      const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
      console.log(
        `\n  Batch ${b + 1}/${totalBatches}: ${embeddings.length} embeddings in ${elapsed}s | heap: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      );

      for (let i = 0; i < batch.length; i++) {
        const vec = embeddings[i];
        if (!vec) continue;
        const embStr = `[${vec.join(',')}]`;
        embeddings[i] = null; // free float array immediately
        await prisma.$executeRawUnsafe(
          `INSERT INTO "ManualChunk" (id, "manualId", "chunkIndex", "pageNumber", content, embedding, "createdAt")
           VALUES ($1, $2, $3, NULL, $4, $5::vector, NOW())`,
          randomUUID(),
          manual.id,
          start + i,
          batch[i],
          embStr,
        );
        processed++;
      }
      console.log(`  ✓ ${processed} total chunks written`);
    } catch (err) {
      failed += batch.length;
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`  ✗ Batch ${b + 1} FAILED: [${e.name}] ${e.message}`);
      if (e.stack) console.error('  ', e.stack.split('\n').slice(1, 4).join('\n  '));
    }
  }

  const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  console.log(`\n─── Result: ${processed} stored, ${failed} failed | heap: ${heapMB}MB`);

  if (!TEST_ALL) {
    // Clean up partial index after test
    await prisma.manualChunk.deleteMany({ where: { manualId: manual.id } });
    console.log('✓ Cleaned up test chunks (run with TEST_ALL=1 to keep)');
  } else if (processed > 0) {
    await prisma.standardManual.update({
      where: { id: manual.id },
      data: { processedAt: new Date(), chunkCount: processed },
    });
    console.log(`✓ Manual marked as processed with ${processed} chunks`);
  }

  await prisma.$disconnect();
  console.log('\n─── Full indexer test complete ─────────────────────\n');
}

run().catch((err) => {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error('Fatal:', e.name, e.message);
  process.exit(1);
});
