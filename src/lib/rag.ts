/**
 * RAG (Retrieval-Augmented Generation) semantic search.
 *
 * Performs vector-similarity search against ManualChunk rows using pgvector's
 * cosine distance operator `<=>`. Returns the top-K most relevant chunks for
 * a given query string.
 *
 * Requires:
 *   - pgvector extension enabled in PostgreSQL.
 *   - The `embedding` column on ManualChunk to be populated (see manual-indexer.ts).
 *   - An active StandardManual record in the database.
 */

import { prisma } from '@/lib/prisma';
import { generateEmbedding } from './ai-client';
import { logger } from '@/lib/logger';

export interface RagRetrievalResult {
  content: string;
  pageNumber: number | null;
  /** Cosine similarity score in the range [0, 1]. Higher = more relevant. */
  similarity: number;
}

/**
 * Perform a semantic search against the ManualChunk table using pgvector cosine
 * distance.
 *
 * @param query      The natural-language query from the user / pipeline.
 * @param categoryId Reserved for future per-category filtering (currently unused).
 * @param topK       Number of top chunks to return (default 5).
 */
export async function retrieveRelevantChunks(
  query: string,
  categoryId: string | null,
  topK: number = 5,
): Promise<RagRetrievalResult[]> {
  if (!query?.trim()) {
    logger.warn({ msg: '[RAG] retrieveRelevantChunks called with empty query' });
    return [];
  }

  // Clamp topK to a sane range
  const k = Math.min(Math.max(topK, 1), 20);

  try {
    // 1. Ensure there is an active manual to search against
    const activeManual = await prisma.standardManual.findFirst({
      where: { isActive: true, processedAt: { not: null } }, // only search indexed manuals
      orderBy: { createdAt: 'desc' },
    });

    if (!activeManual) {
      logger.warn({
        msg: '[RAG] No active, indexed standard manual found. Skipping retrieval.',
      });
      return [];
    }

    // 2. Embed the query
    const queryEmbedding = await generateEmbedding(query.slice(0, 2000)); // cap to avoid huge tokens
    const embeddingString = `[${queryEmbedding.join(',')}]`;

    // 3. Nearest-neighbour cosine distance search via pgvector
    const rows = await prisma.$queryRaw<
      Array<{
        content: string;
        pageNumber: number | null;
        distance: number;
      }>
    >`
      SELECT
        content,
        "pageNumber",
        embedding <=> ${embeddingString}::vector AS distance
      FROM "ManualChunk"
      WHERE "manualId" = ${activeManual.id}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingString}::vector ASC
      LIMIT ${k};
    `;

    logger.info({
      msg: '[RAG] Retrieval complete',
      manualId: activeManual.id,
      query: query.slice(0, 80),
      resultsFound: rows.length,
    });

    return rows.map((row) => ({
      content: row.content,
      pageNumber: row.pageNumber,
      // pgvector cosine distance is in [0, 2]; 1 - distance gives similarity in [-1, 1].
      // For well-formed unit vectors the similarity will be in [0, 1].
      similarity: Math.max(0, 1 - row.distance),
    }));
  } catch (error) {
    logger.error({ msg: '[RAG] Error during semantic retrieval', err: error });
    return [];
  }
}

/**
 * Formats retrieved chunks into a block suitable for injection into an LLM prompt.
 */
export function formatRagContext(chunks: RagRetrievalResult[]): string {
  if (chunks.length === 0) {
    return 'No standard manual references found.';
  }

  return chunks
    .map(
      (chunk, i) =>
        `--- EXCERPT ${i + 1} (Similarity: ${(chunk.similarity * 100).toFixed(1)}%) ---\n` +
        chunk.content +
        (chunk.pageNumber != null ? `\n[Source: Page ${chunk.pageNumber}]` : ''),
    )
    .join('\n\n');
}
