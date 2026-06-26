#!/usr/bin/env node
/**
 * Standalone course-video transcoder.
 *
 * Spawned by video-transcode-worker.ts as a child process so the CPU-heavy
 * ffmpeg encode is isolated from the Next.js server.
 *
 * It downloads the source (raw) video from storage, re-encodes it to a
 * web-safe, universally-playable MP4 — H.264 High / 8-bit yuv420p video + AAC
 * audio, with the moov atom moved to the front (+faststart) — uploads the
 * result, and repoints the lesson / course-preview at the normalized file.
 *
 * The re-encode (rather than a stream copy) is deliberate: source videos are
 * frequently .mov-derived MP4s with the moov atom at the end and/or QuickTime
 * edit lists, which Chrome refuses to play cleanly (black frame / desynced
 * audio / error) while Firefox tolerates them. Re-encoding rewrites a clean
 * container with correct timestamps that plays everywhere, including mobile.
 *
 * Usage:
 *   node scripts/transcode-worker.mjs \
 *     --target-type=lesson|course-preview \
 *     --target-id=<uuid> \
 *     --storage-uri=minio://bucket/key
 *
 * Exit codes: 0 success · 1 fatal (BullMQ retries)
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { stat, unlink } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';

const require = createRequire(import.meta.url);
const execFileP = promisify(execFile);

// ── Load .env (same approach as index-worker.mjs) ────────────────────────────
try {
  const lines = readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
} catch {
  /* rely on environment */
}

// ── Args ─────────────────────────────────────────────────────────────────────
const args = {};
for (const arg of process.argv.slice(2)) {
  const [k, ...rest] = arg.replace(/^--/, '').split('=');
  args[k] = rest.join('=');
}
const targetType = args['target-type'];
const targetId = args['target-id'];
const storageUri = args['storage-uri'];

if (!['lesson', 'course-preview'].includes(targetType) || !targetId || !storageUri) {
  console.error('[transcode-worker] Missing/invalid --target-type, --target-id, or --storage-uri');
  process.exit(1);
}

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ level, msg, ...extra }));

// ── Dependencies ─────────────────────────────────────────────────────────────
const Minio = require('minio');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
// Prisma 7 connects via a driver adapter (no query-engine binary). Mirror db/index.ts.
const prismaAdapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: prismaAdapter });

let minioClient = null;
function getMinio() {
  if (!minioClient) {
    minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'lms_minio_dev',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'lms_minio_secret_dev',
    });
  }
  return minioClient;
}

let gcsStorage = null;
function getGcs() {
  if (!gcsStorage) {
    const { Storage } = require('@google-cloud/storage');
    const rawKey = process.env.GCS_KEY_BASE64;
    if (rawKey) {
      // Mirrors GCSProvider in src/lib/storage/gcs-provider.ts (worker is plain
      // .mjs and can't import the TS module). NEVER log rawKey or decoded fields.
      let parsed;
      try {
        parsed = JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8'));
      } catch {
        log('error', '[transcode-worker] GCS_KEY_BASE64 is malformed (decode/parse failed)', {});
        throw new Error('GCS_KEY_BASE64 is malformed');
      }
      if (
        typeof parsed?.client_email !== 'string' ||
        !parsed.client_email ||
        typeof parsed?.private_key !== 'string' ||
        !parsed.private_key
      ) {
        log('error', '[transcode-worker] GCS_KEY_BASE64 is missing client_email or private_key', {});
        throw new Error('GCS_KEY_BASE64 is missing required service-account fields');
      }
      gcsStorage = new Storage({
        projectId: process.env.GOOGLE_PROJECT_ID,
        credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
      });
    } else {
      // Local dev: resolve via ADC (gcloud login / GOOGLE_APPLICATION_CREDENTIALS).
      gcsStorage = new Storage();
    }
  }
  return gcsStorage;
}

function parseUri(uri) {
  const m = uri.match(/^(minio|gcs):\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Unsupported storage URI: ${uri}`);
  return { scheme: m[1], bucket: m[2], key: m[3] };
}

async function downloadTo(uri, destPath) {
  const { scheme, bucket, key } = parseUri(uri);
  if (scheme === 'minio') {
    await getMinio().fGetObject(bucket, key, destPath);
  } else {
    await getGcs().bucket(bucket).file(key).download({ destination: destPath });
  }
}

async function uploadFrom(srcPath, scheme, bucket, key) {
  if (scheme === 'minio') {
    await getMinio().fPutObject(bucket, key, srcPath, { 'Content-Type': 'video/mp4' });
  } else {
    await getGcs()
      .bucket(bucket)
      .upload(srcPath, { destination: key, metadata: { contentType: 'video/mp4' } });
  }
  return `${scheme}://${bucket}/${key}`;
}

async function probeDurationSeconds(filePath) {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? Math.round(d) : null;
  } catch {
    return null;
  }
}

async function safeUnlink(p) {
  try {
    await unlink(p);
  } catch {
    /* ignore */
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const src = parseUri(storageUri);
  const inputPath = join(tmpdir(), `transcode-in-${randomUUID()}`);
  const outputPath = join(tmpdir(), `transcode-out-${randomUUID()}.mp4`);

  log('info', '[transcode-worker] Starting', { targetType, targetId, storageUri });

  try {
    // 1. Download source
    await downloadTo(storageUri, inputPath);
    const { size: inBytes } = await stat(inputPath);
    log('info', '[transcode-worker] Source downloaded', { inBytes });

    // 2. Re-encode to a web-safe, faststart MP4. -map 0:a:0? keeps audio
    //    optional (silent videos still succeed). -ac 2 normalizes to stereo.
    await execFileP(
      'ffmpeg',
      [
        '-y',
        '-i', inputPath,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast',
        '-crf', '20',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-movflags', '+faststart',
        outputPath,
      ],
      { maxBuffer: 1024 * 1024 * 32 },
    );
    const { size: outBytes } = await stat(outputPath);
    log('info', '[transcode-worker] Encode complete', { outBytes });

    // 3. Probe authoritative duration from the normalized file
    const durationSeconds = await probeDurationSeconds(outputPath);

    // 4. Upload normalized output alongside the source (same provider/bucket)
    const newKey = `system/videos/normalized/${Date.now()}-${randomUUID()}.mp4`;
    const newUri = await uploadFrom(outputPath, src.scheme, src.bucket, newKey);
    log('info', '[transcode-worker] Normalized uploaded', { newUri, durationSeconds });

    // 5. Repoint the target at the normalized video
    if (targetType === 'lesson') {
      await prisma.lesson.update({
        where: { id: targetId },
        data: {
          videoStorageUri: newUri,
          videoProvider: 'self',
          mediaStatus: 'ready',
          ...(durationSeconds != null
            ? {
                videoDurationSeconds: durationSeconds,
                duration: Math.max(1, Math.round(durationSeconds / 60)),
              }
            : {}),
        },
      });
    } else {
      await prisma.course.update({
        where: { id: targetId },
        data: {
          previewVideoStorageUri: newUri,
          previewMediaStatus: 'ready',
          ...(durationSeconds != null ? { previewVideoDurationSeconds: durationSeconds } : {}),
        },
      });
    }

    log('info', '[transcode-worker] Done', { targetType, targetId });
  } finally {
    await safeUnlink(inputPath);
    await safeUnlink(outputPath);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  log('error', '[transcode-worker] Fatal', { err: err?.message ?? String(err) });
  process.exit(1);
});
