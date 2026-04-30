/**
 * Standard Manual PDF indexer.
 *
 * Parses a PDF buffer, splits it into overlapping text chunks, embeds each
 * chunk using the AI client, and stores the results in the ManualChunk table.
 * The embedding vector column is managed outside Prisma's type system via raw
 * SQL (pgvector).
 *
 * Called from: POST /api/system/manual  (non-blocking, fire-and-forget)
 */

// pdf-parse@1.1.1 — pure Node.js, no DOM polyfills required
import pdfParse from 'pdf-parse';
import { prisma } from '@/lib/prisma';
import { generateEmbedding } from './ai-client';
import { logger } from '@/lib/logger';

// ── Chunking constants ────────────────────────────────────────────────────────

const CHUNK_SIZE = 1500; // target characters per chunk (~350 tokens)
const CHUNK_OVERLAP = 200; // characters of overlap between consecutive chunks
const MIN_CHUNK_LENGTH = 50; // discard very short chunks (headers, page numbers, etc.)
const EMBED_DELAY_MS = 200; // delay between embedding API calls to respect rate limits
const LOG_INTERVAL = 10; // log progress every N chunks

// ── Types ─────────────────────────────────────────────────────────────────────

interface TextChunk {
  text: string;
  pageNumber: number | null;
}

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Splits a flat text string into overlapping chunks, each roughly CHUNK_SIZE
 * characters long. Tries to break at sentence boundaries when possible.
 */
function splitTextIntoChunks(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + CHUNK_SIZE;

    if (endIndex < text.length) {
      // Prefer breaking at a sentence boundary within the last 50% of the chunk
      const window = text.substring(startIndex, endIndex);
      const lastPeriod = window.lastIndexOf('. ');
      if (lastPeriod > CHUNK_SIZE * 0.5) {
        endIndex = startIndex + lastPeriod + 1;
      }
    } else {
      endIndex = text.length;
    }

    const chunkText = text.substring(startIndex, endIndex).trim();
    if (chunkText.length >= MIN_CHUNK_LENGTH) {
      chunks.push({ text: chunkText, pageNumber: null });
    }

    // Advance with overlap; guard against zero-progress if endIndex didn't move
    startIndex = endIndex > startIndex ? endIndex - CHUNK_OVERLAP : endIndex;
  }

  return chunks;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Process a PDF Standard Manual:
 *  1. Parse the PDF to extract plain text.
 *  2. Split into overlapping chunks.
 *  3. Embed each chunk via the AI client.
 *  4. Persist chunks + embeddings to the database.
 *  5. Mark the StandardManual record as processed.
 *
 * Designed to run as a background task (non-awaited promise). Errors in
 * individual chunks are logged and skipped; a persistent failure will not
 * update processedAt, leaving the manual in "Processing..." state so the
 * operator knows something went wrong.
 */
export async function indexStandardManual(manualId: string, pdfBuffer: Buffer): Promise<void> {
  logger.info({ msg: '[Indexer] Starting', manualId });

  let processedCount = 0;
  let failedCount = 0;

  try {
    // 1. Parse PDF
    const pdfData = await pdfParse(pdfBuffer);
    const fullText = (pdfData.text || '').trim();

    if (!fullText) {
      logger.warn({ msg: '[Indexer] PDF produced no extractable text', manualId });
      return;
    }

    logger.info({
      msg: '[Indexer] PDF parsed',
      manualId,
      charCount: fullText.length,
    });

    // 2. Chunk
    const chunks = splitTextIntoChunks(fullText);
    logger.info({ msg: '[Indexer] Chunks created', manualId, chunkCount: chunks.length });

    if (chunks.length === 0) {
      logger.warn({ msg: '[Indexer] No chunks created — aborting', manualId });
      return;
    }

    // 3. Delete any previously indexed chunks for this manual (idempotent re-run)
    await prisma.manualChunk.deleteMany({ where: { manualId } });

    // 4. Embed and store each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const embedding = await generateEmbedding(chunk.text);
        const embeddingString = `[${embedding.join(',')}]`;

        // Create the chunk record, then set the vector via raw SQL because
        // Prisma's type system does not model pgvector columns.
        const newChunk = await prisma.manualChunk.create({
          data: {
            manualId,
            chunkIndex: i,
            pageNumber: chunk.pageNumber,
            content: chunk.text,
          },
        });

        await prisma.$executeRaw`
          UPDATE "ManualChunk"
          SET embedding = ${embeddingString}::vector
          WHERE id = ${newChunk.id}
        `;

        processedCount++;

        if (processedCount % LOG_INTERVAL === 0) {
          logger.info({
            msg: '[Indexer] Progress',
            manualId,
            processed: processedCount,
            total: chunks.length,
          });
        }
      } catch (err) {
        failedCount++;
        logger.error({
          msg: '[Indexer] Failed to process chunk',
          manualId,
          chunkIndex: i,
          err,
        });
        // Continue with remaining chunks rather than aborting the whole job
      }

      // Throttle embedding API calls
      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, EMBED_DELAY_MS));
      }
    }

    // 5. Mark manual as processed (only if at least some chunks were indexed)
    if (processedCount > 0) {
      await prisma.standardManual.update({
        where: { id: manualId },
        data: {
          processedAt: new Date(),
          chunkCount: processedCount,
        },
      });

      logger.info({
        msg: '[Indexer] Finished',
        manualId,
        processedCount,
        failedCount,
      });
    } else {
      logger.error({
        msg: '[Indexer] All chunks failed — manual not marked as processed',
        manualId,
        failedCount,
      });
    }
  } catch (err) {
    logger.error({ msg: '[Indexer] Fatal error during indexing', manualId, err });
    // Re-throw so the caller's .catch() handler is invoked
    throw err;
  }
}
