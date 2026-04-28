// pdf-parse@1.1.1 - pure Node.js, no DOM polyfills required
import pdfParse from 'pdf-parse';
import { PrismaClient } from '@prisma/client';
import { generateEmbedding } from './ai-client';

const prisma = new PrismaClient();

const CHUNK_SIZE = 1500; // characters (~350 tokens)
const CHUNK_OVERLAP = 200; // characters

export interface IndexedChunk {
  text: string;
  pageNumber: number | null;
}

/**
 * Basic recursive character splitter.
 * Splitting by paragraphs, then sentences, then words if needed.
 */
function splitTextIntoChunks(text: string): IndexedChunk[] {
  const chunks: IndexedChunk[] = [];

  // A robust chunker would track page numbers accurately, but pdf-parse's
  // page text isn't perfectly segmented without custom render callbacks.
  // For simplicity, we just split by characters with overlap here.
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + CHUNK_SIZE;

    // If not at the end of the string, find the nearest sentence boundary
    if (endIndex < text.length) {
      const remainingText = text.substring(startIndex, endIndex);
      const lastPeriod = remainingText.lastIndexOf('. ');
      if (lastPeriod > CHUNK_SIZE * 0.5) {
        endIndex = startIndex + lastPeriod + 1;
      }
    } else {
      endIndex = text.length;
    }

    chunks.push({
      text: text.substring(startIndex, endIndex).trim(),
      pageNumber: null, // pdf-parse basic usage doesn't give us per-string page numbers easily
    });

    startIndex = endIndex - CHUNK_OVERLAP;
    // Prevent infinite loop if no progress made
    if (startIndex <= 0) startIndex = endIndex;
  }

  return chunks;
}

/**
 * Process a PDF Standard Manual, chunk it, embed it, and insert into DB.
 */
export async function indexStandardManual(manualId: string, pdfBuffer: Buffer): Promise<void> {
  console.log(`[Indexer] Starting indexing for manual ${manualId}...`);

  // 1. Parse PDF using classic pdf-parse v1 (Node-native, no DOM deps)
  const pdfData = await pdfParse(pdfBuffer);
  const fullText = pdfData.text || '';

  console.log(`[Indexer] Extracted ${fullText.length} characters from PDF.`);

  // 2. Chunk the text
  const chunks = splitTextIntoChunks(fullText).filter((c) => c.text.length > 50);
  console.log(`[Indexer] Created ${chunks.length} chunks.`);

  // 3. Process each chunk: embed and store
  // We process sequentially or in small batches to respect rate limits
  let processedCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    try {
      const embedding = await generateEmbedding(chunk.text);
      const embeddingString = `[${embedding.join(',')}]`;

      // Insert chunk text normally, then update embedding via raw SQL
      const newChunk = await prisma.manualChunk.create({
        data: {
          manualId,
          chunkIndex: i,
          pageNumber: chunk.pageNumber,
          content: chunk.text,
        },
      });

      // Execute raw SQL to set the vector
      await prisma.$executeRaw`
        UPDATE "ManualChunk"
        SET embedding = ${embeddingString}::vector
        WHERE id = ${newChunk.id}
      `;

      processedCount++;
      if (processedCount % 10 === 0) {
        console.log(`[Indexer] Processed ${processedCount}/${chunks.length} chunks...`);
      }
    } catch (err) {
      console.error(`[Indexer] Failed to process chunk ${i}:`, err);
    }

    // Add a small delay between requests to avoid hitting rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  // 4. Mark manual as processed
  await prisma.standardManual.update({
    where: { id: manualId },
    data: {
      processedAt: new Date(),
      chunkCount: processedCount,
    },
  });

  console.log(`[Indexer] Finished indexing manual ${manualId}.`);
}
