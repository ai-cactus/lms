/**
 * Diagnostic: test MinIO connectivity and attempt to download the active manual.
 *
 * Run (local: export an env file first; on a server: npm run script <staging|production> <file>):
 *   npx tsx scripts/diagnose-rag.ts
 */
import { Client as MinioClient } from 'minio';
import { prisma } from '@/db/index';
import { logger } from '@/lib/logger';

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

logger.info({ msg: '[diagnose-rag] ─── MinIO Config ───────────────────────────────────' });
logger.info({
  msg: `[diagnose-rag] Endpoint : ${MINIO_ENDPOINT}:${MINIO_PORT} (SSL: ${MINIO_USE_SSL})`,
});
logger.info({ msg: `[diagnose-rag] Bucket   : ${MINIO_BUCKET}` });
logger.info({ msg: `[diagnose-rag] AccessKey: ${MINIO_ACCESS_KEY.slice(0, 4)}****` });

const client = new MinioClient({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

async function run() {
  logger.info({ msg: '[diagnose-rag] ─── Step 1: Bucket check ───────────────────────────' });
  try {
    const exists = await client.bucketExists(MINIO_BUCKET);
    logger.info({ msg: `[diagnose-rag] Bucket "${MINIO_BUCKET}" exists: ${exists}` });
    if (!exists) {
      logger.error({ msg: '[diagnose-rag] ✗ Bucket does not exist — check MINIO_BUCKET env var' });
      return;
    }
  } catch (err) {
    logger.error({
      msg: '[diagnose-rag] ✗ bucketExists failed',
      errMessage: errText(err),
      code: errCode(err),
    });
    return;
  }

  logger.info({ msg: '[diagnose-rag] ─── Step 2: Active manual in DB ────────────────────' });
  const manual = await prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!manual) {
    logger.info({ msg: '[diagnose-rag] ✗ No active standard manual found in DB' });
    return;
  }
  logger.info({ msg: `[diagnose-rag] ✓ Found: ${manual.filename} (id: ${manual.id})` });
  logger.info({ msg: `[diagnose-rag] storagePath: ${manual.storagePath}` });
  logger.info({ msg: `[diagnose-rag] processedAt: ${manual.processedAt ?? 'null (not indexed)'}` });
  logger.info({ msg: `[diagnose-rag] chunkCount : ${manual.chunkCount}` });

  logger.info({ msg: '[diagnose-rag] ─── Step 3: Parse storage URI ──────────────────────' });
  const uri = manual.storagePath;
  const match = uri.match(/^(gcs|minio):\/\/([^/]+)\/(.+)$/);
  if (!match) {
    logger.error({ msg: `[diagnose-rag] ✗ Cannot parse storageUri: ${uri}` });
    return;
  }
  const [, backend, bucket, key] = match;
  logger.info({ msg: `[diagnose-rag] backend: ${backend}` });
  logger.info({ msg: `[diagnose-rag] bucket : ${bucket}` });
  logger.info({ msg: `[diagnose-rag] key    : ${key}` });

  if (backend !== 'minio') {
    logger.info({ msg: `[diagnose-rag] ⚠ Backend is "${backend}" — skipping MinIO download test` });
    return;
  }

  logger.info({ msg: '[diagnose-rag] ─── Step 4: Download test ──────────────────────────' });
  try {
    const stream = await client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    logger.info({ msg: `[diagnose-rag] ✓ Downloaded ${buf.length} bytes` });
    const magic = buf.subarray(0, 4).toString('ascii');
    logger.info({
      msg: `[diagnose-rag] PDF magic bytes: "${magic}" — ${magic === '%PDF' ? '✓ valid PDF' : '✗ NOT a valid PDF'}`,
    });
  } catch (err) {
    logger.error({
      msg: `[diagnose-rag] ✗ getObject failed: [${errCode(err) || 'error'}] ${errText(err)}`,
    });
  }

  logger.info({ msg: '[diagnose-rag] ─── Step 5: ManualChunk count in DB ───────────────' });
  try {
    const count = await prisma.manualChunk.count({ where: { manualId: manual.id } });
    logger.info({ msg: `[diagnose-rag] ManualChunk rows for this manual: ${count}` });
  } catch (err) {
    logger.error({
      msg: '[diagnose-rag] ✗ ManualChunk count query failed',
      errMessage: errText(err),
    });
  }

  await prisma.$disconnect();
  logger.info({ msg: '[diagnose-rag] ─── Diagnosis complete ─────────────────────────────' });
}

run().catch((err) => {
  logger.error({ msg: '[diagnose-rag] Fatal', err });
  process.exit(1);
});
