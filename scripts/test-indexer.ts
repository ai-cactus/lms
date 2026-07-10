/**
 * Directly test the indexStandardManual pipeline against the active manual.
 *
 * Run (pass the env file of the target environment):
 *   npm run script .env.local test-indexer.ts
 */
import { Client as MinioClient } from 'minio';
import pdfParse from 'pdf-parse';
import { prisma } from '@/db/index';

interface EmbedContentResponse {
  embedding?: { values?: number[] };
  error?: unknown;
}

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
  const VERTEX_EMBEDDING_MODEL = process.env.VERTEX_EMBEDDING_MODEL || 'text-embedding-004';
  const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;

  console.log(
    `  GOOGLE_AI_API_KEY: ${GOOGLE_AI_API_KEY ? GOOGLE_AI_API_KEY.slice(0, 6) + '****' : 'NOT SET'}`,
  );
  console.log(`  GOOGLE_PROJECT_ID: ${GOOGLE_VERTEX_PROJECT ?? 'NOT SET'}`);

  const testChunk = (pdfData.text || '').slice(0, 300).trim();
  if (!testChunk) {
    console.log('  ⚠ No text to embed');
    return;
  }

  // Try Gemini REST API (what ai-client.ts likely uses)
  if (GOOGLE_AI_API_KEY) {
    const model = VERTEX_EMBEDDING_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GOOGLE_AI_API_KEY}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: testChunk }] } }),
      });
      const responseBody = (await res.json()) as EmbedContentResponse;
      if (!res.ok) {
        console.error(`  ✗ Embedding API error ${res.status}:`, JSON.stringify(responseBody));
      } else {
        const dim = responseBody.embedding?.values?.length ?? 0;
        console.log(`  ✓ Embedding OK — ${dim} dimensions`);
      }
    } catch (err) {
      console.error(`  ✗ Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log('  ⚠ No GOOGLE_AI_API_KEY — skipping embedding test');
  }

  await prisma.$disconnect();
  console.log('\n─── Test complete ──────────────────────────────────\n');
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
