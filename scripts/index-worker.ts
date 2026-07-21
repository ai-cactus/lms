#!/usr/bin/env node
/**
 * Standalone PDF indexer process.
 *
 * Spawned by manual-indexer-worker.ts as a child process (via `node --import tsx`)
 * so the heavy embedding work runs in its own V8 heap, completely isolated from
 * the Next.js server. If this process OOMs, it fails this job only; it never
 * takes down the server.
 *
 * Usage:
 *   node --max-old-space-size=3000 --expose-gc --import tsx scripts/index-worker.ts \
 *     --manual-id=<uuid> --storage-path=minio://bucket/key
 *
 * Exit codes:
 *   0  success
 *   1  fatal error (job should be retried by BullMQ)
 */

import { writeFileSync, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client as MinioClient } from 'minio';
import { GoogleAuth } from 'google-auth-library';
import { prisma } from '@/db/index';

const execFileP = promisify(execFile);

interface EmbeddingResponse {
  predictions: Array<{ embeddings: { values: number[] } }>;
}

// ── Parse argv ────────────────────────────────────────────────────────────────
const args: Record<string, string> = {};
for (const arg of process.argv.slice(2)) {
  const [k, ...rest] = arg.replace(/^--/, '').split('=');
  args[k] = rest.join('=');
}

const manualId = args['manual-id'];
const storagePath = args['storage-path'];

if (!manualId || !storagePath) {
  console.error('[index-worker] Missing --manual-id or --storage-path');
  process.exit(1);
}

// ── Dependencies ──────────────────────────────────────────────────────────────
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

const MINIO = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: parseInt(process.env.MINIO_PORT ?? '9005', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? '',
  secretKey: process.env.MINIO_SECRET_KEY ?? '',
});

// ── Constants ─────────────────────────────────────────────────────────────────
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const MIN_CHUNK_LEN = 50;
const EMBED_BATCH_SIZE = 40;
const LOG_INTERVAL = 3;

const PROJECT_ID = process.env.GOOGLE_PROJECT_ID || 'theraptly-lms';
const LOCATION = process.env.GOOGLE_LOCATION || 'us-central1';
const MODEL = 'text-embedding-004';
const EMBED_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;

// ── GC helper ─────────────────────────────────────────────────────────────────
function maybeGc() {
  try {
    const g = (globalThis as { gc?: () => void }).gc;
    if (typeof g === 'function') g();
  } catch {
    /* --expose-gc not enabled */
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  process.stdout.write(
    JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra }) + '\n',
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  const len = text.length;

  while (start < len) {
    let end = Math.min(start + CHUNK_SIZE, len);

    if (end < len) {
      // Manual backward scan for '. ' — avoids any V8 internal
      // structures that lastIndexOf might build for large strings.
      const boundary = start + (CHUNK_SIZE >> 1); // halfway minimum
      let found = -1;
      for (let j = end - 2; j >= boundary; j--) {
        if (text.charCodeAt(j) === 46 && text.charCodeAt(j + 1) === 32) {
          found = j;
          break;
        }
      }
      if (found !== -1) end = found + 1;
    }

    // charCodeAt-based trim on parent string
    let ts = start,
      te = end;
    while (ts < te && text.charCodeAt(ts) <= 32) ts++;
    while (te > ts && text.charCodeAt(te - 1) <= 32) te--;

    if (te - ts >= MIN_CHUNK_LEN) chunks.push(text.substring(ts, te));

    start = end < len ? end - CHUNK_OVERLAP : len;
  }

  return chunks;
}

async function extractText(buf: Buffer): Promise<string> {
  const id = randomUUID();
  const tmpPdf = join(tmpdir(), `iw-${id}.pdf`);
  const tmpTxt = join(tmpdir(), `iw-${id}.txt`);
  try {
    writeFileSync(tmpPdf, buf);
    await execFileP('pdftotext', ['-enc', 'UTF-8', '-nopgbrk', tmpPdf, tmpTxt]);
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
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      instances: texts.map((t) => ({ task_type: 'RETRIEVAL_DOCUMENT', title: '', content: t })),
    }),
  });
  if (!res.ok) throw new Error(`Embed API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as EmbeddingResponse;
  return json.predictions.map((p) => p.embeddings.values);
}

// ── Heap logger ───────────────────────────────────────────────────────────────
function H(label: string) {
  const m = process.memoryUsage();
  const mb = (v: number) => Math.round(v / 1024 / 1024);
  process.stdout.write(
    `[HEAP] ${label}: used=${mb(m.heapUsed)} total=${mb(m.heapTotal)} rss=${mb(m.rss)} MB\n`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  H('start');
  log('info', '[index-worker] Starting', { manualId, storagePath });

  // 1. Download PDF
  const match = storagePath.match(/^minio:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Unsupported storagePath: ${storagePath}`);

  const chunks: Buffer[] = [];
  const stream = await MINIO.getObject(match[1], match[2]);
  await new Promise<void>((res, rej) => {
    stream.on('data', (d: Buffer) => chunks.push(d));
    stream.on('end', () => res());
    stream.on('error', rej);
  });
  const buf = Buffer.concat(chunks);
  H('after-download');
  log('info', '[index-worker] PDF downloaded', { sizeBytes: buf.length });

  // 2. Extract text
  const rawText = await extractText(buf);
  const fullText = rawText.trim();
  H('after-extract');
  maybeGc();
  H('after-extract-gc');
  log('info', '[index-worker] Text extracted', { charCount: fullText.length });

  // 3. Chunk — poll heap every second to observe when it grows
  const chunkPollId = setInterval(() => H('chunk-poll'), 1000);
  const allChunks = chunkText(fullText);
  clearInterval(chunkPollId);
  const totalChunks = allChunks.length;
  H('after-chunk');
  maybeGc();
  H('after-chunk-gc');
  log('info', '[index-worker] Chunked', { totalChunks });
  if (totalChunks === 0) {
    log('warn', '[index-worker] No chunks — aborting');
    return;
  }

  // 4. Clear existing
  await prisma.manualChunk.deleteMany({ where: { manualId } });
  H('after-deleteMany');

  // 5. Embed + write
  const totalBatches = Math.ceil(totalChunks / EMBED_BATCH_SIZE);
  let processed = 0,
    failed = 0;

  for (let b = 0; b < totalBatches; b++) {
    const bStart = b * EMBED_BATCH_SIZE;
    const batchTexts = allChunks.slice(bStart, Math.min(bStart + EMBED_BATCH_SIZE, totalChunks));

    H(`batch-${b + 1}-start`);
    let embeddings: (number[] | null)[];
    try {
      embeddings = await batchEmbed(batchTexts);
      H(`batch-${b + 1}-embed-done`);
    } catch (batchErr) {
      failed += batchTexts.length;
      log('error', '[index-worker] Batch embed failed', { batch: b + 1, err: errMsg(batchErr) });
      continue;
    }

    for (let i = 0; i < batchTexts.length; i++) {
      const vec = embeddings[i];
      if (!vec) continue;
      const embStr = `[${vec.join(',')}]`;
      embeddings[i] = null;
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "ManualChunk" (id,"manualId","chunkIndex","pageNumber",content,embedding,"createdAt")
           VALUES ($1,$2,$3,NULL,$4,$5::vector,NOW())`,
          randomUUID(),
          manualId,
          bStart + i,
          batchTexts[i],
          embStr,
        );
        processed++;
        if (i === 0 || i === 49 || i === 99) H(`batch-${b + 1}-insert-${i}`);
      } catch (dbErr) {
        failed++;
        log('error', '[index-worker] DB insert failed', {
          chunkIndex: bStart + i,
          err: errMsg(dbErr),
        });
      }
    }

    maybeGc();
    H(`batch-${b + 1}-after-gc`);

    if ((b + 1) % LOG_INTERVAL === 0 || b === totalBatches - 1) {
      log('info', '[index-worker] Progress', {
        batch: `${b + 1}/${totalBatches}`,
        processed,
        failed,
        totalChunks,
      });
    }
  }

  // 6. Finalise
  await prisma.standardManual.update({
    where: { id: manualId },
    data: { processedAt: new Date(), chunkCount: processed },
  });

  if (processed > 0) {
    log('info', '[index-worker] Complete', { processed, failed, totalChunks });
  } else {
    log('error', '[index-worker] Complete with failures', { processed, failed, totalChunks });
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error('[index-worker] Fatal:', e.name, e.message);
  process.exit(1);
});
