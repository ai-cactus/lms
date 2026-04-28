import { PrismaClient } from '@prisma/client';
import { generateEmbedding } from './ai-client';

const prisma = new PrismaClient();

export interface RagRetrievalResult {
  content: string;
  pageNumber: number | null;
  similarity: number;
}

/**
 * Perform a semantic search against the ManualChunk table using pgvector cosine distance.
 * Returns the top K most relevant chunks.
 */
export async function retrieveRelevantChunks(
  query: string,
  categoryId: string | null, // If category is selected, filter by it (future enhancement), or just globally
  topK: number = 5,
): Promise<RagRetrievalResult[]> {
  // 1. Generate an embedding for the user's query
  const queryEmbedding = await generateEmbedding(query);
  const embeddingString = `[${queryEmbedding.join(',')}]`;

  try {
    // 2. Perform vector cosine distance search
    // We only search within the active StandardManual.
    // The `<=>` operator computes cosine distance. 1 - distance = cosine similarity.
    const activeManual = await prisma.standardManual.findFirst({
      where: { isActive: true },
    });

    if (!activeManual) {
      console.warn('[RAG] No active standard manual found. Skipping retrieval.');
      return [];
    }

    // Use $queryRaw to perform the nearest neighbor search
    const results = await prisma.$queryRaw<
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
      ORDER BY embedding <=> ${embeddingString}::vector ASC
      LIMIT ${topK};
    `;

    // 3. Map distance to similarity score
    return results.map((row) => ({
      content: row.content,
      pageNumber: row.pageNumber,
      similarity: 1 - row.distance,
    }));
  } catch (error) {
    console.error('[RAG] Error during semantic retrieval:', error);
    return [];
  }
}

/**
 * Combines retrieved chunks into a formatted context block for injection into the prompt.
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
        (chunk.pageNumber ? `\n[Source: Page ${chunk.pageNumber}]` : ''),
    )
    .join('\n\n');
}
