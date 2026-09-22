import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { getSignedUrl, uploadFile } from '@/lib/storage';
import { buildPosterArgs } from '@/lib/video/encoding';

const execFileP = promisify(execFile);

/**
 * Signed-URL lifetime for the ffmpeg read. Generous because a large source over
 * a slow link still has to complete its Range reads within the window.
 */
const SIGNED_URL_TTL_SECONDS = 900;

const DEFAULT_KEY_PREFIX = 'system/videos/posters/';

export interface ExtractPosterOptions {
  /** Kill ffmpeg after this long. Omitted = no limit (the backfill's behaviour). */
  timeoutMs?: number;
  /** Object-key prefix for the uploaded still; must end in `/`. */
  keyPrefix?: string;
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    /* already gone */
  }
}

function isMissingBinary(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * Runs ffmpeg under `nice -n 19` so an extraction started from the web process
 * yields CPU to the server it shares a container with — the same reason
 * video-transcode-worker.ts renices the transcode child. `nice` is coreutils
 * and always present in the runtime image; if it is somehow missing, fall back
 * to an un-niced run rather than failing the extraction.
 */
async function runFfmpeg(args: string[], timeoutMs: number | undefined): Promise<void> {
  const options = { maxBuffer: 1024 * 1024 * 8, ...(timeoutMs ? { timeout: timeoutMs } : {}) };
  try {
    await execFileP('nice', ['-n', '19', 'ffmpeg', ...args], options);
  } catch (err) {
    if (!isMissingBinary(err)) throw err;
    await execFileP('ffmpeg', args, options);
  }
}

/**
 * Extracts one still from `videoStorageUri` and uploads it, returning the new
 * storage URI. Throws on failure; callers decide whether that is fatal.
 *
 * The source video is NEVER downloaded in full: ffmpeg is pointed at the
 * storage signed URL and issues its own Range requests, and `-ss` before `-i`
 * is an input seek, so it reads little more than the header plus one keyframe.
 */
export async function extractAndUploadPoster(
  videoStorageUri: string,
  durationSeconds: number | null,
  options: ExtractPosterOptions = {},
): Promise<string> {
  const posterPath = join(tmpdir(), `poster-${randomUUID()}.jpg`);
  try {
    const signedUrl = await getSignedUrl(videoStorageUri, SIGNED_URL_TTL_SECONDS);
    await runFfmpeg(buildPosterArgs(signedUrl, posterPath, durationSeconds), options.timeoutMs);
    const buffer = await readFile(posterPath);
    const key = `${options.keyPrefix ?? DEFAULT_KEY_PREFIX}${Date.now()}-${randomUUID()}.jpg`;
    const uploaded = await uploadFile(key, buffer, 'image/jpeg');
    return uploaded.storageUri;
  } finally {
    await safeUnlink(posterPath);
  }
}
