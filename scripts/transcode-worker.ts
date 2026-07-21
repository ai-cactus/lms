#!/usr/bin/env node
/**
 * Standalone course-video transcoder.
 *
 * Spawned by video-transcode-worker.ts as a child process (via `node --import tsx`)
 * so the CPU-heavy ffmpeg encode is isolated from the Next.js server.
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
 *   node --import tsx scripts/transcode-worker.ts \
 *     --target-type=lesson|course-preview \
 *     --target-id=<uuid> \
 *     --storage-uri=minio://bucket/key
 *
 * Exit codes: 0 success · 1 fatal (BullMQ retries)
 */

import { stat, unlink } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client as MinioClient } from 'minio';
import { Storage } from '@google-cloud/storage';
import { prisma } from '@/db/index';

const execFileP = promisify(execFile);

// ── Args ─────────────────────────────────────────────────────────────────────
const args: Record<string, string> = {};
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

const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, ...extra }));

// ── Storage clients ──────────────────────────────────────────────────────────
let minioClient: MinioClient | null = null;
function getMinio(): MinioClient {
  if (!minioClient) {
    minioClient = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'lms_minio_dev',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'lms_minio_secret_dev',
    });
  }
  return minioClient;
}

let gcsStorage: Storage | null = null;
function getGcs(): Storage {
  if (!gcsStorage) {
    const rawKey = process.env.GCS_KEY_BASE64;
    if (rawKey) {
      // Mirrors GCSProvider in src/lib/storage/gcs-provider.ts.
      // NEVER log rawKey or decoded fields.
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8'));
      } catch {
        log('error', '[transcode-worker] GCS_KEY_BASE64 is malformed (decode/parse failed)', {});
        throw new Error('GCS_KEY_BASE64 is malformed');
      }
      const key = parsed as { client_email?: unknown; private_key?: unknown };
      if (
        typeof key.client_email !== 'string' ||
        !key.client_email ||
        typeof key.private_key !== 'string' ||
        !key.private_key
      ) {
        log('error', '[transcode-worker] GCS_KEY_BASE64 is missing client_email or private_key', {});
        throw new Error('GCS_KEY_BASE64 is missing required service-account fields');
      }
      gcsStorage = new Storage({
        projectId: process.env.GOOGLE_PROJECT_ID,
        credentials: { client_email: key.client_email, private_key: key.private_key },
      });
    } else {
      // Local dev: resolve via ADC (gcloud login / GOOGLE_APPLICATION_CREDENTIALS).
      gcsStorage = new Storage();
    }
  }
  return gcsStorage;
}

interface ParsedUri {
  scheme: string;
  bucket: string;
  key: string;
}

function parseUri(uri: string): ParsedUri {
  const m = uri.match(/^(minio|gcs):\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Unsupported storage URI: ${uri}`);
  return { scheme: m[1], bucket: m[2], key: m[3] };
}

async function downloadTo(uri: string, destPath: string): Promise<void> {
  const { scheme, bucket, key } = parseUri(uri);
  if (scheme === 'minio') {
    await getMinio().fGetObject(bucket, key, destPath);
  } else {
    await getGcs().bucket(bucket).file(key).download({ destination: destPath });
  }
}

async function uploadFrom(
  srcPath: string,
  scheme: string,
  bucket: string,
  key: string,
): Promise<string> {
  if (scheme === 'minio') {
    await getMinio().fPutObject(bucket, key, srcPath, { 'Content-Type': 'video/mp4' });
  } else {
    await getGcs()
      .bucket(bucket)
      .upload(srcPath, { destination: key, metadata: { contentType: 'video/mp4' } });
  }
  return `${scheme}://${bucket}/${key}`;
}

async function probeDurationSeconds(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? Math.round(d) : null;
  } catch {
    return null;
  }
}

async function safeUnlink(p: string): Promise<void> {
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
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
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
  log('error', '[transcode-worker] Fatal', {
    err: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
