/**
 * Browser-side GCS resumable upload client.
 *
 * Implements Google Cloud Storage's resumable upload protocol against a V4
 * signed *resumable* URL minted server-side. Because the bytes go straight to
 * GCS, they never transit Cloudflare/Nginx/Next.js and so escape the body-size
 * and request-timeout limits that 524-time out large multipart POSTs.
 *
 * Protocol reference:
 *   https://cloud.google.com/storage/docs/performing-resumable-uploads
 *
 * Pure TypeScript — no React. Runs in the browser (uses fetch + File.slice).
 */

/** GCS requires every chunk except the final one to be a multiple of 256 KiB. */
const CHUNK_MULTIPLE = 256 * 1024;
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB
const DEFAULT_MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 16000;

export interface ResumableUploadOptions {
  /** The V4 signed resumable initiation URL (POST endpoint). */
  uploadUrl: string;
  file: File;
  /** Called with overall percent complete (0–100) after each confirmed chunk. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  /** Bytes per chunk. Rounded down to a 256 KiB multiple. Default 8 MiB. */
  chunkSize?: number;
  /** Consecutive failures tolerated per chunk before giving up. Default 3. */
  maxRetries?: number;
}

/** Rounds a requested chunk size down to a valid 256 KiB multiple (min one multiple). */
function normalizeChunkSize(requested: number): number {
  const rounded = Math.floor(requested / CHUNK_MULTIPLE) * CHUNK_MULTIPLE;
  return rounded >= CHUNK_MULTIPLE ? rounded : CHUNK_MULTIPLE;
}

/** Exponential backoff, capped. */
function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Upload cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Upload cancelled', 'AbortError');
  }
}

/**
 * Parse the confirmed end byte from a 308 `Range: bytes=0-N` response header.
 * Returns -1 when no Range header is present (nothing committed yet).
 */
function parseConfirmedEnd(rangeHeader: string | null): number {
  if (!rangeHeader) return -1;
  const match = rangeHeader.match(/bytes=0-(\d+)/);
  return match ? Number(match[1]) : -1;
}

/**
 * Phase 1 — initiate the resumable session.
 * Returns the session URI from the `Location` response header.
 */
async function initiateSession(opts: ResumableUploadOptions): Promise<string> {
  const res = await fetch(opts.uploadUrl, {
    method: 'POST',
    headers: {
      // Must match the contentType bound into the signed URL.
      'Content-Type': opts.file.type,
      'x-goog-resumable': 'start',
    },
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(`Failed to start upload session (HTTP ${res.status})`);
  }

  const sessionUri = res.headers.get('location');
  if (!sessionUri) {
    // Almost always a CORS misconfiguration: the bucket must expose the
    // `Location` response header for the browser to read it.
    throw new Error(
      'Upload session URI missing from response — check the bucket CORS responseHeader allows "Location".',
    );
  }
  return sessionUri;
}

/**
 * Query the server for how many bytes it has committed so we can resume.
 * Returns the next offset to send, or the total when the upload is already done.
 */
async function queryOffset(
  sessionUri: string,
  total: number,
  signal?: AbortSignal,
): Promise<number> {
  const res = await fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${total}` },
    signal,
  });

  // Already complete.
  if (res.status === 200 || res.status === 201) {
    return total;
  }
  if (res.status === 308) {
    const confirmedEnd = parseConfirmedEnd(res.headers.get('range'));
    return confirmedEnd + 1; // -1 → 0 (restart), N → N+1
  }
  throw new Error(`Unexpected status querying upload offset (HTTP ${res.status})`);
}

/**
 * Upload a single chunk starting at `offset`. Returns the next offset (always
 * derived from GCS's confirmed `Range`, never assumed), or `total` on completion.
 */
async function uploadChunk(
  sessionUri: string,
  file: File,
  offset: number,
  chunkSize: number,
  total: number,
  signal?: AbortSignal,
): Promise<number> {
  const end = Math.min(offset + chunkSize, total);
  const blob = file.slice(offset, end);

  const res = await fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` },
    body: blob,
    signal,
  });

  // Final chunk committed.
  if (res.status === 200 || res.status === 201) {
    return total;
  }
  // Intermediate chunk: trust GCS's confirmed end byte for the next offset.
  if (res.status === 308) {
    const confirmedEnd = parseConfirmedEnd(res.headers.get('range'));
    return confirmedEnd >= 0 ? confirmedEnd + 1 : offset;
  }
  throw new Error(`Chunk upload failed (HTTP ${res.status})`);
}

/**
 * Upload `file` to GCS via the resumable protocol. Resolves when the object is
 * fully committed; rejects with an AbortError if `signal` aborts.
 */
export async function resumableUpload(opts: ResumableUploadOptions): Promise<void> {
  const { file, onProgress, signal } = opts;

  if (file.size === 0) {
    throw new Error('Cannot upload an empty file');
  }

  throwIfAborted(signal);

  const chunkSize = normalizeChunkSize(opts.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const total = file.size;

  const sessionUri = await initiateSession(opts);

  let offset = 0;
  let attempt = 0;

  while (offset < total) {
    throwIfAborted(signal);

    try {
      offset = await uploadChunk(sessionUri, file, offset, chunkSize, total, signal);
      attempt = 0; // reset retry budget after a successful chunk
      onProgress?.(Math.min((offset / total) * 100, 100));
    } catch (err) {
      // Propagate cancellation immediately — do not retry an aborted upload.
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }

      attempt += 1;
      if (attempt > maxRetries) {
        throw err instanceof Error ? err : new Error('Chunk upload failed');
      }

      await delay(backoffMs(attempt), signal);

      // Re-sync with GCS before retrying so we resume from its confirmed offset
      // rather than blindly resending (the chunk may have partially landed).
      offset = await queryOffset(sessionUri, total, signal);
    }
  }

  onProgress?.(100);
}
