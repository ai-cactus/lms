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
 * The encode profile itself (resolution cap, bitrate ceiling, fixed keyframe
 * interval, and its VIDEO_* env knobs) lives in src/lib/video/encoding.ts.
 * Outputs are stamped with VIDEO_ENCODING_VERSION so assets predating the
 * profile stay identifiable.
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
import {
  VIDEO_ENCODING_VERSION,
  buildPosterArgs,
  buildTranscodeArgs,
  resolveEncodeSettings,
} from '@/lib/video/encoding';

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
        log(
          'error',
          '[transcode-worker] GCS_KEY_BASE64 is missing client_email or private_key',
          {},
        );
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
  contentType = 'video/mp4',
): Promise<string> {
  if (scheme === 'minio') {
    await getMinio().fPutObject(bucket, key, srcPath, { 'Content-Type': contentType });
  } else {
    await getGcs().bucket(bucket).upload(srcPath, { destination: key, metadata: { contentType } });
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

/**
 * Average frame rate of `filePath`'s first video stream, or null when it can't
 * be read. Feeds the frame-rate CAP in `buildTranscodeArgs`, which is applied
 * only for a source known to exceed it — so null correctly means "leave the
 * frame rate alone" rather than "normalise it".
 *
 * `avg_frame_rate` (not `r_frame_rate`) because ffprobe reports the latter as
 * the timebase tick rate for variable-frame-rate sources — commonly a wildly
 * high value like 1000/1 for a screen recording, which would trip the cap on a
 * video that never actually runs fast.
 */
async function probeFrameRate(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=avg_frame_rate',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    // ffprobe emits a rational, e.g. "30000/1001"; "0/0" means unknown.
    const [num, den] = stdout.trim().split('/');
    const fps = Number(num) / Number(den ?? 1);
    return Number.isFinite(fps) && fps > 0 ? fps : null;
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

/**
 * Extracts a still frame from `videoPath` and uploads it beside the video,
 * returning its storage URI — or `null` if anything went wrong.
 *
 * ⚠️ NON-FATAL BY CONSTRUCTION. A poster is a cosmetic optimization; the video
 * itself is the deliverable. If this threw, the transcode job would fail, BullMQ
 * would retry it, and after the final attempt the target would be left at
 * `mediaStatus: 'failed'` — i.e. a perfectly good video reported as broken and
 * hidden from learners. Every failure mode here (no ffmpeg, an unreadable frame,
 * a storage outage) therefore resolves to `null` and lets the run continue.
 */
async function generatePoster(
  videoPath: string,
  posterPath: string,
  durationSeconds: number | null,
  dest: ParsedUri,
): Promise<string | null> {
  try {
    await execFileP('ffmpeg', buildPosterArgs(videoPath, posterPath, durationSeconds), {
      maxBuffer: 1024 * 1024 * 8,
    });
    const posterKey = `system/videos/posters/${Date.now()}-${randomUUID()}.jpg`;
    const posterUri = await uploadFrom(
      posterPath,
      dest.scheme,
      dest.bucket,
      posterKey,
      'image/jpeg',
    );
    log('info', '[transcode-worker] Poster uploaded', { posterUri });
    return posterUri;
  } catch (err) {
    log('warn', '[transcode-worker] Poster generation failed — continuing without one', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const src = parseUri(storageUri);
  const inputPath = join(tmpdir(), `transcode-in-${randomUUID()}`);
  const outputPath = join(tmpdir(), `transcode-out-${randomUUID()}.mp4`);
  const posterPath = join(tmpdir(), `transcode-poster-${randomUUID()}.jpg`);

  log('info', '[transcode-worker] Starting', { targetType, targetId, storageUri });

  try {
    // 1. Download source
    await downloadTo(storageUri, inputPath);
    const { size: inBytes } = await stat(inputPath);
    log('info', '[transcode-worker] Source downloaded', { inBytes });

    // 2. Re-encode to a web-safe, faststart MP4 using the normalization profile
    //    in @/lib/video/encoding (resolution cap, bitrate ceiling, fixed GOP).
    const { settings, invalidEnvVars } = resolveEncodeSettings();
    if (invalidEnvVars.length > 0) {
      log('warn', '[transcode-worker] Ignoring invalid encode env vars — using defaults', {
        invalidEnvVars,
      });
    }
    const sourceFps = await probeFrameRate(inputPath);
    log('info', '[transcode-worker] Encoding', { ...settings, sourceFps });

    await execFileP('ffmpeg', buildTranscodeArgs(inputPath, outputPath, settings, sourceFps), {
      maxBuffer: 1024 * 1024 * 32,
    });
    const { size: outBytes } = await stat(outputPath);
    log('info', '[transcode-worker] Encode complete', { outBytes });

    // 3. Probe authoritative duration from the normalized file
    const durationSeconds = await probeDurationSeconds(outputPath);

    // 4. Upload normalized output alongside the source (same provider/bucket)
    const newKey = `system/videos/normalized/${Date.now()}-${randomUUID()}.mp4`;
    const newUri = await uploadFrom(outputPath, src.scheme, src.bucket, newKey);
    log('info', '[transcode-worker] Normalized uploaded', { newUri, durationSeconds });

    // 5. Extract a still poster from the NORMALIZED output, so the poster always
    //    matches the video that will actually be delivered.
    const posterUri = await generatePoster(outputPath, posterPath, durationSeconds, src);

    // 6. Repoint the target at the normalized video
    if (targetType === 'lesson') {
      await prisma.lesson.update({
        where: { id: targetId },
        data: {
          videoStorageUri: newUri,
          videoProvider: 'self',
          mediaStatus: 'ready',
          videoEncodingVersion: VIDEO_ENCODING_VERSION,
          // Only written when extraction succeeded — a failed poster must never
          // clear a good one left by an earlier run or the backfill.
          ...(posterUri ? { videoPosterStorageUri: posterUri } : {}),
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
          previewVideoEncodingVersion: VIDEO_ENCODING_VERSION,
          ...(posterUri ? { previewPosterStorageUri: posterUri } : {}),
          ...(durationSeconds != null ? { previewVideoDurationSeconds: durationSeconds } : {}),
        },
      });
    }

    log('info', '[transcode-worker] Done', { targetType, targetId });
  } finally {
    await safeUnlink(inputPath);
    await safeUnlink(outputPath);
    await safeUnlink(posterPath);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  log('error', '[transcode-worker] Fatal', {
    err: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
