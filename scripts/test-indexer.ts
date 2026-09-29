/**
 * Directly test the manual-indexing pipeline (manual-indexer-worker) against the active manual.
 *
 * Run (local: export an env file first; on a server: npm run script <staging|production> <file>):
 *   npx tsx scripts/test-indexer.ts
 */
import { Client as MinioClient } from 'minio';
import pdfParse from 'pdf-parse';
import { prisma } from '@/db/index';
import { generateBatchEmbeddings } from '@/lib/ai-client';
import { logger } from '@/lib/logger';

const client = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: parseInt(process.env.MINIO_PORT ?? '9005', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'lms_minio_dev',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'lms_minio_secret_dev',
});

async function downloadBuffer(storagePath: string): Promise<Buffer> {
  const match = storagePath.match(/^minio:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Cannot parse: ${storagePath}`);
  const [, bucket, key] = match;
  const stream = await client.getObject(bucket, key);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function run() {
  const manual = await prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!manual) {
    logger.error({ msg: '[test-indexer] No active manual in DB' });
    return;
  }
  logger.info({ msg: `[test-indexer] Testing against: ${manual.filename} (${manual.id})` });
  logger.info({ msg: `[test-indexer] storagePath: ${manual.storagePath}` });

  logger.info({ msg: '[test-indexer] ─── Downloading PDF...' });
  const buf = await downloadBuffer(manual.storagePath);
  logger.info({ msg: `[test-indexer] ✓ Downloaded ${buf.length} bytes` });

  logger.info({ msg: '[test-indexer] ─── Parsing PDF with pdf-parse...' });
  let pdfData;
  try {
    pdfData = await pdfParse(buf);
    logger.info({ msg: `[test-indexer] ✓ Extracted ${pdfData.text?.length ?? 0} characters` });
    logger.info({ msg: `[test-indexer] Pages: ${pdfData.numpages}` });
    logger.info({
      msg: `[test-indexer] First 200 chars: ${JSON.stringify(pdfData.text?.slice(0, 200))}`,
    });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error({ msg: '[test-indexer] ✗ pdf-parse FAILED', err: e });
    return;
  }

  logger.info({ msg: '[test-indexer] ─── Testing embedding API...' });
  const GOOGLE_VERTEX_PROJECT = process.env.GOOGLE_PROJECT_ID || process.env.GCP_PROJECT_ID;
  logger.info({ msg: `[test-indexer] GOOGLE_PROJECT_ID: ${GOOGLE_VERTEX_PROJECT ?? 'NOT SET'}` });

  const testChunk = (pdfData.text || '').slice(0, 300).trim();
  if (!testChunk) {
    logger.info({ msg: '[test-indexer] ⚠ No text to embed' });
    return;
  }

  // Goes through the same BAA-covered Vertex AI path the app uses
  // (generateBatchEmbeddings → *-aiplatform.googleapis.com, OAuth service
  // account). This block previously POSTed the extracted document text to
  // generativelanguage.googleapis.com with a GEMINI_API_KEY — the consumer
  // endpoint, which carries no BAA. Pointed at a real customer manual, that
  // was an uncontrolled disclosure of document content; it also tested an API
  // the app does not use. See the PHI egress guard in eslint.config.mjs.
  try {
    const [embedding] = await generateBatchEmbeddings([testChunk]);
    logger.info({ msg: `[test-indexer] ✓ Embedding OK — ${embedding?.length ?? 0} dimensions` });
  } catch (err) {
    logger.error({
      msg: `[test-indexer] ✗ Embedding failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  await prisma.$disconnect();
  logger.info({ msg: '[test-indexer] ─── Test complete ──────────────────────────────────' });
}

run().catch((err) => {
  logger.error({ msg: '[test-indexer] Fatal', err });
  process.exit(1);
});
