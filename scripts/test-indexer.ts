/**
 * Directly test the indexStandardManual pipeline against the active manual.
 *
 * Run (local: export an env file first; on a server: npm run script <staging|production> <file>):
 *   npx tsx scripts/test-indexer.ts
 */
import { Client as MinioClient } from 'minio';
import pdfParse from 'pdf-parse';
import { prisma } from '@/db/index';
import { generateBatchEmbeddings } from '@/lib/ai-client';

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
    console.error('No active manual in DB');
    return;
  }
  console.log(`\nTesting against: ${manual.filename} (${manual.id})`);
  console.log(`storagePath: ${manual.storagePath}`);

  console.log('\n─── Downloading PDF...');
  const buf = await downloadBuffer(manual.storagePath);
  console.log(`✓ Downloaded ${buf.length} bytes`);

  console.log('\n─── Parsing PDF with pdf-parse...');
  let pdfData;
  try {
    pdfData = await pdfParse(buf);
    console.log(`✓ Extracted ${pdfData.text?.length ?? 0} characters`);
    console.log(`  Pages: ${pdfData.numpages}`);
    console.log(`  First 200 chars: ${JSON.stringify(pdfData.text?.slice(0, 200))}`);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(`✗ pdf-parse FAILED: [${e.name}] ${e.message}`);
    console.error(e.stack);
    return;
  }

  console.log('\n─── Testing embedding API...');
  const GOOGLE_VERTEX_PROJECT = process.env.GOOGLE_PROJECT_ID || process.env.GCP_PROJECT_ID;
  console.log(`  GOOGLE_PROJECT_ID: ${GOOGLE_VERTEX_PROJECT ?? 'NOT SET'}`);

  const testChunk = (pdfData.text || '').slice(0, 300).trim();
  if (!testChunk) {
    console.log('  ⚠ No text to embed');
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
    console.log(`  ✓ Embedding OK — ${embedding?.length ?? 0} dimensions`);
  } catch (err) {
    console.error(`  ✗ Embedding failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  await prisma.$disconnect();
  console.log('\n─── Test complete ──────────────────────────────────\n');
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
