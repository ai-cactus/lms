/**
 * Diagnostic: test MinIO connectivity and attempt to download the active manual.
 *
 * Run (local: export an env file first; on a server: npm run script <staging|production> <file>):
 *   npx tsx scripts/diagnose-rag.ts
 */
import { Client as MinioClient } from 'minio';
import { prisma } from '@/db/index';

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function errCode(e: unknown): string {
  const code = (e as { code?: string; name?: string })?.code;
  return code ?? '';
}

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? 'localhost';
const MINIO_PORT = parseInt(process.env.MINIO_PORT ?? '9000', 10);
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? 'lms_minio_dev';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? 'lms_minio_secret_dev';
const MINIO_BUCKET = process.env.MINIO_BUCKET ?? 'lms-documents';

console.log('\n─── MinIO Config ───────────────────────────────────');
console.log(`  Endpoint : ${MINIO_ENDPOINT}:${MINIO_PORT} (SSL: ${MINIO_USE_SSL})`);
console.log(`  Bucket   : ${MINIO_BUCKET}`);
console.log(`  AccessKey: ${MINIO_ACCESS_KEY.slice(0, 4)}****`);

const client = new MinioClient({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

async function run() {
  console.log('\n─── Step 1: Bucket check ───────────────────────────');
  try {
    const exists = await client.bucketExists(MINIO_BUCKET);
    console.log(`  Bucket "${MINIO_BUCKET}" exists: ${exists}`);
    if (!exists) {
      console.error('  ✗ Bucket does not exist — check MINIO_BUCKET env var');
      return;
    }
  } catch (err) {
    console.error('  ✗ bucketExists failed:', errText(err), errCode(err));
    return;
  }

  console.log('\n─── Step 2: Active manual in DB ────────────────────');
  const manual = await prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!manual) {
    console.log('  ✗ No active standard manual found in DB');
    return;
  }
  console.log(`  ✓ Found: ${manual.filename} (id: ${manual.id})`);
  console.log(`    storagePath: ${manual.storagePath}`);
  console.log(`    processedAt: ${manual.processedAt ?? 'null (not indexed)'}`);
  console.log(`    chunkCount : ${manual.chunkCount}`);

  console.log('\n─── Step 3: Parse storage URI ──────────────────────');
  const uri = manual.storagePath;
  const match = uri.match(/^(gcs|minio):\/\/([^/]+)\/(.+)$/);
  if (!match) {
    console.error(`  ✗ Cannot parse storageUri: ${uri}`);
    return;
  }
  const [, backend, bucket, key] = match;
  console.log(`  backend: ${backend}`);
  console.log(`  bucket : ${bucket}`);
  console.log(`  key    : ${key}`);

  if (backend !== 'minio') {
    console.log(`  ⚠ Backend is "${backend}" — skipping MinIO download test`);
    return;
  }

  console.log('\n─── Step 4: Download test ──────────────────────────');
  try {
    const stream = await client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    console.log(`  ✓ Downloaded ${buf.length} bytes`);
    const magic = buf.subarray(0, 4).toString('ascii');
    console.log(
      `  PDF magic bytes: "${magic}" — ${magic === '%PDF' ? '✓ valid PDF' : '✗ NOT a valid PDF'}`,
    );
  } catch (err) {
    console.error(`  ✗ getObject failed: [${errCode(err) || 'error'}] ${errText(err)}`);
  }

  console.log('\n─── Step 5: ManualChunk count in DB ───────────────');
  try {
    const count = await prisma.manualChunk.count({ where: { manualId: manual.id } });
    console.log(`  ManualChunk rows for this manual: ${count}`);
  } catch (err) {
    console.error('  ✗ ManualChunk count query failed:', errText(err));
  }

  await prisma.$disconnect();
  console.log('\n─── Diagnosis complete ─────────────────────────────\n');
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
