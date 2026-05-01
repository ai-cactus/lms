#!/usr/bin/env node
/**
 * End-to-end test of the full indexing pipeline using pdftotext + batch embeddings.
 * Mirrors the exact code path the BullMQ worker takes.
 *
 * Run: node scripts/test-full-indexer.mjs
 *
 * Tests the first 3 batches only (300 chunks) to validate correctness quickly.
 * Set TEST_ALL=1 to run the full indexing.
 */

import { createRequire } from 'module';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

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

const Minio     = require('minio');
const { PrismaClient } = require('@prisma/client');
const { GoogleAuth }   = require('google-auth-library');

const prisma = new PrismaClient();
const auth   = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

const MINIO = new Minio.Client({
  endPoint:  process.env.MINIO_ENDPOINT  ?? 'localhost',
  port:      parseInt(process.env.MINIO_PORT ?? '9005', 10),
  useSSL:    process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'lms_minio_dev',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'lms_minio_secret_dev',
});

const CHUNK_SIZE    = 1500;
const CHUNK_OVERLAP = 200;
const MIN_LEN       = 50;
const BATCH_SIZE    = 100;
const PROJECT_ID    = process.env.GOOGLE_PROJECT_ID || 'theraptly-lms';
const LOCATION      = process.env.GOOGLE_LOCATION   || 'us-central1';
const MODEL         = 'text-embedding-004';
const TEST_ALL      = process.env.TEST_ALL === '1';
const TEST_BATCHES  = 3;

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    if (end < text.length) {
      const w = text.substring(start, end);
      const lp = w.lastIndexOf('. ');
      if (lp > CHUNK_SIZE * 0.5) end = start + lp + 1;
    } else { end = text.length; }
    const t = text.substring(start, end).trim();
    if (t.length >= MIN_LEN) chunks.push(t);
    start = end > start ? end - CHUNK_OVERLAP : end;
  }
  return chunks;
}

async function extractText(buf) {
  const id     = randomUUID();
  const tmpPdf = join(tmpdir(), `test-${id}.pdf`);
  const tmpTxt = join(tmpdir(), `test-${id}.txt`);
  try {
    writeFileSync(tmpPdf, buf);
    await execFileAsync('pdftotext', ['-enc', 'UTF-8', '-nopgbrk', tmpPdf, tmpTxt]);
    return await readFile(tmpTxt, 'utf8');
  } finally {
    try { unlinkSync(tmpPdf); } catch {}
    try { unlinkSync(tmpTxt); } catch {}
  }
}

async function batchEmbed(texts) {
  const token = await auth.getAccessToken();
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ instances: texts.map(t => ({ task_type: 'RETRIEVAL_DOCUMENT', title: '', content: t })) }),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.predictions.map(p => p.embeddings.values);
}

async function run() {
  const manual = await prisma.standardManual.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } });
  if (!manual) { console.error('No active manual'); return; }
  console.log(`\nManual: ${manual.filename} (${manual.id})`);

  // Download
  console.log('\n─── Step 1: Download PDF...');
  const match = manual.storagePath.match(/^minio:\/\/([^/]+)\/(.+)$/);
  const stream = await MINIO.getObject(match[1], match[2]);
  const bufChunks = [];
  await new Promise((res, rej) => { stream.on('data', d => bufChunks.push(d)); stream.on('end', res); stream.on('error', rej); });
  const buf = Buffer.concat(bufChunks);
  console.log(`✓ ${buf.length} bytes | heap: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

  // Extract text
  console.log('\n─── Step 2: Extract text via pdftotext...');
  const t0 = Date.now();
  const text = await extractText(buf);
  console.log(`✓ ${text.length} chars in ${((Date.now()-t0)/1000).toFixed(1)}s | heap: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

  // Chunk
  const allChunks = chunkText(text.trim());
  const limit     = TEST_ALL ? allChunks.length : BATCH_SIZE * TEST_BATCHES;
  const chunks    = allChunks.slice(0, limit);
  console.log(`\n─── Step 3: Chunks: ${allChunks.length} total, testing ${chunks.length} (${Math.ceil(chunks.length / BATCH_SIZE)} batches)...`);

  // Clear old
  await prisma.manualChunk.deleteMany({ where: { manualId: manual.id } });
  console.log('✓ Cleared existing chunks');

  // Batch embed + write
  let processed = 0, failed = 0;
  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const start = b * BATCH_SIZE;
    const batch = chunks.slice(start, start + BATCH_SIZE);
    const t1 = Date.now();
    try {
      const embeddings = await batchEmbed(batch);
      const elapsed = ((Date.now()-t1)/1000).toFixed(1);
      console.log(`\n  Batch ${b+1}/${totalBatches}: ${embeddings.length} embeddings in ${elapsed}s | heap: ${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB`);

      for (let i = 0; i < batch.length; i++) {
        const embStr = `[${embeddings[i].join(',')}]`;
        embeddings[i] = null; // free float array immediately
        await prisma.$executeRawUnsafe(
          `INSERT INTO "ManualChunk" (id, "manualId", "chunkIndex", "pageNumber", content, embedding, "createdAt")
           VALUES ($1, $2, $3, NULL, $4, $5::vector, NOW())`,
          randomUUID(), manual.id, start + i, batch[i], embStr,
        );
        processed++;
      }
      console.log(`  ✓ ${processed} total chunks written`);
    } catch (err) {
      failed += batch.length;
      console.error(`  ✗ Batch ${b+1} FAILED: [${err.name}] ${err.message}`);
      if (err.stack) console.error('  ', err.stack.split('\n').slice(1,4).join('\n  '));
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

run().catch(err => { console.error('Fatal:', err.name, err.message); process.exit(1); });
