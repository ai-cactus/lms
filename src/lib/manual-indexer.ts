/**
 * Standard Manual PDF indexer.
 *
 * Text extraction strategy:
 *   Uses the system `pdftotext` binary (poppler-utils) instead of pdfjs-dist.
 *   pdftotext runs as a separate process and frees its memory when done,
 *   avoiding the multi-GB heap growth caused by pdfjs loading all PDF pages
 *   into JavaScript objects simultaneously.
 *
 * Embedding strategy:
 *   Chunks are embedded in batches of EMBED_BATCH_SIZE via the Vertex AI
 *   batch predict API (up to 250 instances per call). Only one batch of
 *   embedding float arrays lives in memory at a time.
 *
 * The embedding vector column is managed outside Prisma's type system via raw
 * SQL (pgvector).
 *
 * Called from: BullMQ manual-indexer-worker
 */

import { execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { generateBatchEmbeddings } from './ai-client';
import { logger } from '@/lib/logger';

// ── Chunking constants ────────────────────────────────────────────────────────

const CHUNK_SIZE = 1500; // target characters per chunk (~350 tokens)
const CHUNK_OVERLAP = 200; // characters of overlap between consecutive chunks
const MIN_CHUNK_LEN = 50; // discard very short chunks

// Vertex AI text-embedding-004 supports up to 250 instances per request.
// 100 balances throughput with memory pressure.
const EMBED_BATCH_SIZE = 100;

const LOG_INTERVAL = 3; // log progress every N batches

// ── GC helper ────────────────────────────────────────────────────────────────

// V8 defers major GC until the heap is close to --max-old-space-size (4 GB).
// Without explicit collection between embedding batches, retained fetch/Prisma
// buffers accumulate (~370 MB/batch) and crash the server after ~16 minutes.
// We pass --expose-gc in NODE_OPTIONS to enable this call.

declare const gc: undefined | (() => void);

function maybeGc(): void {
  try {
    if (typeof gc === 'function') gc();
  } catch {
    // --expose-gc not set — best-effort only
  }
}

// ── PDF text extraction ───────────────────────────────────────────────────────

/**
 * Extract plain text from a PDF buffer using the system `pdftotext` binary.
 *
 * Writes the buffer to a temp file, runs pdftotext, reads stdout, then
 * cleans up. The entire operation happens out-of-process so the PDF's
 * internal representation never inflates the Node.js heap.
 *
 * @throws Error if pdftotext exits with a non-zero code or is not installed.
 */
async function extractTextFromPdf(pdfBuffer: Buffer): Promise<string> {
  const tmpId = randomUUID();
  const tmpPdf = join(tmpdir(), `manual-${tmpId}.pdf`);
  const tmpTxt = join(tmpdir(), `manual-${tmpId}.txt`);

  try {
    await writeFile(tmpPdf, pdfBuffer);

    await new Promise<void>((resolve, reject) => {
      execFile(
        'pdftotext',
        [
          '-enc',
          'UTF-8', // force UTF-8 output
          '-nopgbrk', // omit form-feed characters between pages
          tmpPdf,
          tmpTxt,
        ],
        (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`pdftotext failed (exit ${err.code}): ${stderr || err.message}`));
          } else {
            resolve();
          }
        },
      );
    });

    // Read the extracted text file
    const { readFile } = await import('fs/promises');
    const text = await readFile(tmpTxt, 'utf8');
    return text.trim();
  } finally {
    // Always clean up temp files
    await Promise.all([unlink(tmpPdf).catch(() => {}), unlink(tmpTxt).catch(() => {})]);
  }
}

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Splits a flat text string into overlapping chunks, returning plain strings.
 */
function splitTextIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = Math.min(startIndex + CHUNK_SIZE, text.length);

    if (endIndex < text.length) {
      // Search directly on the parent string to avoid creating a SlicedString
      // and calling lastIndexOf() on it. Calling SlicedString.lastIndexOf on a
      // very large parent triggers a V8 Runtime_GrowArrayElements invalid-size
      // crash on this platform.
      const dotPos = text.lastIndexOf('. ', endIndex - 1);
      if (dotPos >= startIndex + CHUNK_SIZE * 0.5 && dotPos < endIndex) {
        endIndex = dotPos + 1;
      }
    }

    // Trim by scanning charCodes on the parent — avoids SlicedString.trim()
    let ts = startIndex,
      te = endIndex;
    while (ts < te && text.charCodeAt(ts) <= 32) ts++;
    while (te > ts && text.charCodeAt(te - 1) <= 32) te--;

    if (te - ts >= MIN_CHUNK_LEN) {
      chunks.push(text.substring(ts, te));
    }

    startIndex = endIndex < text.length ? endIndex - CHUNK_OVERLAP : text.length;
  }

  return chunks;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Process a PDF Standard Manual end-to-end:
 *  1. Extract text via pdftotext (out-of-process, memory-safe)
 *  2. Split into overlapping chunks
 *  3. Embed in batches via Vertex AI batch predict
 *  4. Write each batch to DB, then release embeddings from memory
 *  5. Mark the StandardManual record as processed
 *
 * Throws on fatal errors so the BullMQ worker can mark the job as failed.
 */
export async function indexStandardManual(manualId: string, pdfBuffer: Buffer): Promise<void> {
  logger.info({ msg: '[Indexer] Starting', manualId, pdfSizeBytes: pdfBuffer.length });

  let processedCount = 0;
  let failedCount = 0;

  try {
    // 1. Extract text via pdftotext — runs out-of-process, no heap bloat
    logger.info({ msg: '[Indexer] Extracting PDF text via pdftotext', manualId });
    const fullText = await extractTextFromPdf(pdfBuffer);

    if (!fullText) {
      logger.warn({ msg: '[Indexer] PDF produced no extractable text', manualId });
      return;
    }

    logger.info({
      msg: '[Indexer] PDF text extracted',
      manualId,
      charCount: fullText.length,
    });

    // 2. Chunk the text
    const chunks = splitTextIntoChunks(fullText);
    const totalChunks = chunks.length;

    logger.info({ msg: '[Indexer] Chunked', manualId, totalChunks });

    if (totalChunks === 0) {
      logger.warn({ msg: '[Indexer] No chunks produced — aborting', manualId });
      return;
    }

    // 3. Clear any previously indexed chunks (idempotent re-run support)
    await prisma.manualChunk.deleteMany({ where: { manualId } });

    // 4. Batch embed + write — one batch at a time to cap memory usage
    const totalBatches = Math.ceil(totalChunks / EMBED_BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchStart = batchIdx * EMBED_BATCH_SIZE;
      const batchEnd = Math.min(batchStart + EMBED_BATCH_SIZE, totalChunks);
      const batchTexts = chunks.slice(batchStart, batchEnd);

      try {
        const embeddings = await generateBatchEmbeddings(batchTexts);

        for (let i = 0; i < batchTexts.length; i++) {
          const chunkIndex = batchStart + i;
          const embeddingString = `[${embeddings[i].join(',')}]`;

          // Release the float array immediately after stringifying
          (embeddings as (number[] | null)[])[i] = null;

          try {
            // Single INSERT with inline vector cast — avoids two round-trips
            // and prevents Prisma's internal query engine from accumulating
            // intermediate ManualChunk result objects.
            await prisma.$executeRawUnsafe(
              `INSERT INTO manual_chunks (id, manual_id, chunk_index, page_number, content, embedding, created_at)
               VALUES ($1, $2, $3, NULL, $4, $5::vector, NOW())`,
              randomUUID(),
              manualId,
              chunkIndex,
              batchTexts[i],
              embeddingString,
            );

            processedCount++;
          } catch (dbErr) {
            failedCount++;
            logger.error({
              msg: '[Indexer] DB insert failed for chunk',
              manualId,
              chunkIndex,
              err: dbErr,
            });
          }
        }
      } catch (batchErr) {
        failedCount += batchTexts.length;
        logger.error({
          msg: '[Indexer] Batch embedding API call failed',
          manualId,
          batchIdx: batchIdx + 1,
          totalBatches,
          err: batchErr,
        });
      }

      // Explicitly collect garbage after each batch.
      // V8 won't run a major GC until heap hits the 4 GB limit, causing
      // retained fetch/Prisma objects to accumulate across all 11 batches.
      maybeGc();

      if ((batchIdx + 1) % LOG_INTERVAL === 0 || batchIdx === totalBatches - 1) {
        logger.info({
          msg: '[Indexer] Progress',
          manualId,
          batch: `${batchIdx + 1}/${totalBatches}`,
          processed: processedCount,
          failed: failedCount,
          total: totalChunks,
        });
      }
    }

    // 5. Finalise
    await prisma.standardManual.update({
      where: { id: manualId },
      data: { processedAt: new Date(), chunkCount: processedCount },
    });

    if (processedCount > 0) {
      logger.info({
        msg: '[Indexer] Complete',
        manualId,
        processedCount,
        failedCount,
        totalChunks,
      });
    } else {
      logger.error({
        msg: '[Indexer] Complete with failures',
        manualId,
        processedCount,
        failedCount,
        totalChunks,
      });
    }
  } catch (err) {
    logger.error({ msg: '[Indexer] Fatal error', manualId, err });
    throw err;
  }
}
