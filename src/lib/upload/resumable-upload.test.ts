/**
 * Unit tests for src/lib/upload/resumable-upload.ts
 *
 * All I/O is mocked via vi.stubGlobal('fetch', ...).
 * Backoff delays are controlled with vi.useFakeTimers() inside individual tests.
 *
 * Covered:
 *   Happy path
 *     - Single chunk: POST initiates session, PUT uploads, onProgress hits 100
 *     - Single chunk: accepts HTTP 201 as complete
 *     - No onProgress: resolves without throwing
 *   Multi-chunk
 *     - Two chunks: correct Content-Range headers on both PUTs
 *     - Server Range header trusted over local chunk boundary when they differ
 *   Initiation errors
 *     - Missing Location header -> throws descriptive error
 *     - Non-2xx initiation response -> throws
 *   Retry / backoff
 *     - Chunk fails once then succeeds -> retried via query-offset resume
 *     - query-offset PUT sends Content-Range: bytes STAR /total (GCS resume protocol)
 *     - Resumes from server-confirmed offset, not local guess
 *     - Exceeds maxRetries -> rejects
 *     - Retry counter resets after each successful chunk
 *   Abort
 *     - Signal already aborted -> throws AbortError, no fetch calls
 *     - Fetch rejects with AbortError mid-upload -> AbortError propagated, no retry
 *   Edge cases
 *     - Empty file (size 0) -> throws immediately
 *     - chunkSize not 256 KiB-aligned -> rounded down
 *     - chunkSize below 256 KiB minimum -> normalised to 256 KiB
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resumableUpload } from './resumable-upload';

const CHUNK = 256 * 1024; // 256 KiB — minimum GCS-valid chunk size

const UPLOAD_URL =
  'https://storage.googleapis.com/upload/storage/v1/b/bucket/o?upload_type=resumable&name=key';
const SESSION_URI =
  'https://storage.googleapis.com/upload/storage/v1/b/bucket/o?upload_id=AAANsUkFQIWu';

/** Construct a minimal Response with the given status and optional headers. */
function makeResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: new Headers(headers) });
}

/** Create a File whose content is `size` zero-bytes (Blob.slice() is usable). */
function makeFile(size: number, type = 'video/mp4', name = 'test.mp4'): File {
  return new File([new Uint8Array(size)], name, { type });
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers(); // restore real timers after any test that used fake timers
});

describe('resumableUpload — happy path (single chunk)', () => {
  it('sends POST to initiate the session, then one PUT that covers the whole file', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI }))
      .mockResolvedValueOnce(makeResponse(200));

    const file = makeFile(1024);
    const onProgress = vi.fn();

    await resumableUpload({ uploadUrl: UPLOAD_URL, file, onProgress });

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Initiation POST
    const [initUrl, initOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(initUrl).toBe(UPLOAD_URL);
    expect(initOpts.method).toBe('POST');
    expect((initOpts.headers as Record<string, string>)['x-goog-resumable']).toBe('start');
    expect((initOpts.headers as Record<string, string>)['Content-Type']).toBe('video/mp4');

    // Upload PUT
    const [putUrl, putOpts] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(putUrl).toBe(SESSION_URI);
    expect(putOpts.method).toBe('PUT');
    expect((putOpts.headers as Record<string, string>)['Content-Range']).toBe('bytes 0-1023/1024');

    // Final progress report
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  it('accepts HTTP 201 as the upload-complete signal', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI }))
      .mockResolvedValueOnce(makeResponse(201));

    await expect(
      resumableUpload({ uploadUrl: UPLOAD_URL, file: makeFile(512) }),
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('resolves without error when onProgress is omitted', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI }))
      .mockResolvedValueOnce(makeResponse(200));

    // Should not throw even with no onProgress callback.
    await expect(
      resumableUpload({ uploadUrl: UPLOAD_URL, file: makeFile(512) }),
    ).resolves.toBeUndefined();
  });
});

describe('resumableUpload — multi-chunk', () => {
  it('issues two PUT requests with correct Content-Range headers for a two-chunk file', async () => {
    const fileSize = CHUNK * 2;

    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI }))
      // Chunk 1: 308 Resume Incomplete, full CHUNK confirmed
      .mockResolvedValueOnce(makeResponse(308, { range: `bytes=0-${CHUNK - 1}` }))
      // Chunk 2: 200 Complete
      .mockResolvedValueOnce(makeResponse(200));

    const onProgress = vi.fn();
    await resumableUpload({
      uploadUrl: UPLOAD_URL,
      file: makeFile(fileSize),
      onProgress,
      chunkSize: CHUNK,
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);

    const [, c1Opts] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect((c1Opts.headers as Record<string, string>)['Content-Range']).toBe(
      `bytes 0-${CHUNK - 1}/${fileSize}`,
    );

    const [, c2Opts] = mockFetch.mock.calls[2] as [string, RequestInit];
    expect((c2Opts.headers as Record<string, string>)['Content-Range']).toBe(
      `bytes ${CHUNK}-${fileSize - 1}/${fileSize}`,
    );

    // ~50% after chunk 1, 100 at end
    expect(onProgress).toHaveBeenCalledWith(50);
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  it('trusts the server Range header over the local chunk boundary when they differ', async () => {
    // File: 2 chunks. We send CHUNK bytes but the server only confirms 1024.
    // The next PUT must start at 1025, not CHUNK.
    const fileSize = CHUNK * 2;
    const serverConfirmedEnd = 1023;

    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI }))
      .mockResolvedValueOnce(makeResponse(308, { range: `bytes=0-${serverConfirmedEnd}` }))
      .mockResolvedValueOnce(makeResponse(200));

    await resumableUpload({ uploadUrl: UPLOAD_URL, file: makeFile(fileSize), chunkSize: CHUNK });

    const [, c2Opts] = mockFetch.mock.calls[2] as [string, RequestInit];
    const cr = (c2Opts.headers as Record<string, string>)['Content-Range'];
    // Must start from server-confirmed offset + 1, not from our chunk boundary.
    expect(cr).toMatch(new RegExp(`^bytes ${serverConfirmedEnd + 1}-`));
  });
});

describe('resumableUpload — initiation errors', () => {
  it('throws a descriptive error when Location header is absent from the init response', async () => {
    // 200 but no Location — usually a CORS misconfiguration.
    mockFetch.mockResolvedValueOnce(makeResponse(200));

    await expect(resumableUpload({ uploadUrl: UPLOAD_URL, file: makeFile(1024) })).rejects.toThrow(
      /location|session uri/i,
    );

    // No chunk PUT should be attempted.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws when the initiation POST returns a non-2xx status', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(403));

    await expect(resumableUpload({ uploadUrl: UPLOAD_URL, file: makeFile(1024) })).rejects.toThrow(
      /403/,
    );
  });
});

describe('resumableUpload — retry on transient chunk failure', () => {
  it('retries a failed chunk and completes when the retry succeeds', async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI })) // init
      .mockResolvedValueOnce(makeResponse(503)) // chunk 1 fails
      .mockResolvedValueOnce(makeResponse(308)) // query-offset: no Range -> restart from 0
      .mockResolvedValueOnce(makeResponse(200)); // retry succeeds

    const file = makeFile(CHUNK);
    const promise = resumableUpload({ uploadUrl: UPLOAD_URL, file, maxRetries: 1 });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    // init + failed chunk + query-offset + retry = 4
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('sends Content-Range bytes-star/total on the query-offset PUT after a chunk failure', async () => {
    vi.useFakeTimers();

    const total = CHUNK;
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI }))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(308))
      .mockResolvedValueOnce(makeResponse(200));

    const file = makeFile(total);
    const promise = resumableUpload({ uploadUrl: UPLOAD_URL, file, maxRetries: 1 });
    await vi.runAllTimersAsync();
    await promise;

    // 3rd fetch call is the query-offset PUT.
    const [queryUrl, queryOpts] = mockFetch.mock.calls[2] as [string, RequestInit];
    expect(queryUrl).toBe(SESSION_URI);
    expect(queryOpts.method).toBe('PUT');
    // The GCS resume-query header: "bytes */<total>"
    expect((queryOpts.headers as Record<string, string>)['Content-Range']).toBe(`bytes */${total}`);
  });

  it('resumes from the server-confirmed offset returned by the query-offset response', async () => {
    vi.useFakeTimers();

    const total = CHUNK * 2;
    const serverConfirmedEnd = 1023; // server only has the first 1024 bytes

    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI }))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(308, { range: `bytes=0-${serverConfirmedEnd}` }))
      .mockResolvedValueOnce(makeResponse(200));

    const file = makeFile(total);
    const promise = resumableUpload({
      uploadUrl: UPLOAD_URL,
      file,
      maxRetries: 1,
      chunkSize: CHUNK,
    });
    await vi.runAllTimersAsync();
    await promise;

    // The retry PUT (4th call) must start from server-confirmed offset + 1.
    const [, retryOpts] = mockFetch.mock.calls[3] as [string, RequestInit];
    const cr = (retryOpts.headers as Record<string, string>)['Content-Range'];
    expect(cr).toMatch(new RegExp(`^bytes ${serverConfirmedEnd + 1}-`));
  });

  it('rejects when consecutive chunk failures exceed maxRetries', async () => {
    vi.useFakeTimers();

    // maxRetries = 2 -> 3 chunk attempts total. The sequence:
    // init, chunk(fail), qoff, chunk(fail), qoff, chunk(fail->exceed) -> throw
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI })) // init
      .mockResolvedValueOnce(makeResponse(503)) // chunk attempt 1 -> attempt=1
      .mockResolvedValueOnce(makeResponse(308)) // query-offset 1
      .mockResolvedValueOnce(makeResponse(503)) // chunk attempt 2 -> attempt=2
      .mockResolvedValueOnce(makeResponse(308)) // query-offset 2
      .mockResolvedValueOnce(makeResponse(503)); // chunk attempt 3 -> attempt=3>2 -> throw

    const file = makeFile(CHUNK);
    const promise = resumableUpload({ uploadUrl: UPLOAD_URL, file, maxRetries: 2 });

    // Attach the rejection handler BEFORE advancing timers so vitest doesn't
    // see the rejection as unhandled while the timers are still running.
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('resets the retry counter after each successful chunk so each chunk has its own budget', async () => {
    vi.useFakeTimers();

    // Two chunks. Chunk 1 fails once then succeeds. Chunk 2 also fails once then succeeds.
    // With maxRetries=1: if the counter accumulated, chunk 2 failure would exceed budget.
    // The upload must complete because the counter resets after chunk 1 succeeds.
    const total = CHUNK * 2;

    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI })) // init
      .mockResolvedValueOnce(makeResponse(503)) // chunk 1 fails -> attempt=1
      .mockResolvedValueOnce(makeResponse(308)) // query-offset 1
      .mockResolvedValueOnce(makeResponse(308, { range: `bytes=0-${CHUNK - 1}` })) // chunk 1 retry ok -> attempt reset to 0
      .mockResolvedValueOnce(makeResponse(503)) // chunk 2 fails -> attempt=1 (fresh budget)
      .mockResolvedValueOnce(makeResponse(308, { range: `bytes=0-${CHUNK - 1}` })) // query-offset 2
      .mockResolvedValueOnce(makeResponse(200)); // chunk 2 retry ok

    const file = makeFile(total);
    const promise = resumableUpload({
      uploadUrl: UPLOAD_URL,
      file,
      maxRetries: 1,
      chunkSize: CHUNK,
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(7);
  });
});

describe('resumableUpload — abort', () => {
  it('throws AbortError immediately when the signal is already aborted before upload starts', async () => {
    const controller = new AbortController();
    controller.abort();

    const err = await resumableUpload({
      uploadUrl: UPLOAD_URL,
      file: makeFile(1024),
      signal: controller.signal,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');

    // No fetch calls should have been made.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws AbortError when fetch itself rejects with AbortError mid-upload, with no retry', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI }))
      // The PUT rejects with AbortError, mimicking real browser abort behaviour.
      .mockRejectedValueOnce(new DOMException('Upload cancelled', 'AbortError'));

    const err = await resumableUpload({
      uploadUrl: UPLOAD_URL,
      file: makeFile(1024),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');

    // Exactly 2 calls: init + one aborted PUT. No query-offset or retry.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('resumableUpload — edge cases', () => {
  it('throws immediately for an empty file (size 0) without calling fetch', async () => {
    await expect(resumableUpload({ uploadUrl: UPLOAD_URL, file: makeFile(0) })).rejects.toThrow(
      /empty/i,
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rounds chunkSize down to the nearest 256 KiB multiple when it is not aligned', async () => {
    // 300 KiB -> normalised to 256 KiB -> a 512 KiB file needs 2 chunks.
    const fileSize = CHUNK * 2;

    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI }))
      .mockResolvedValueOnce(makeResponse(308, { range: `bytes=0-${CHUNK - 1}` }))
      .mockResolvedValueOnce(makeResponse(200));

    await resumableUpload({
      uploadUrl: UPLOAD_URL,
      file: makeFile(fileSize),
      chunkSize: 300 * 1024, // not a 256 KiB multiple
    });

    // Chunk 1 must cover 0-{CHUNK-1}, not 0-{300*1024-1}.
    const [, c1Opts] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect((c1Opts.headers as Record<string, string>)['Content-Range']).toBe(
      `bytes 0-${CHUNK - 1}/${fileSize}`,
    );
  });

  it('normalises a chunkSize below 256 KiB up to one CHUNK_MULTIPLE (256 KiB)', async () => {
    // 100 KiB < 256 KiB -> normalised to 256 KiB -> file fits in one chunk.
    const fileSize = CHUNK;

    mockFetch
      .mockResolvedValueOnce(makeResponse(200, { location: SESSION_URI }))
      .mockResolvedValueOnce(makeResponse(200));

    await resumableUpload({
      uploadUrl: UPLOAD_URL,
      file: makeFile(fileSize),
      chunkSize: 100 * 1024,
    });

    const [, putOpts] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect((putOpts.headers as Record<string, string>)['Content-Range']).toBe(
      `bytes 0-${CHUNK - 1}/${CHUNK}`,
    );
  });
});
