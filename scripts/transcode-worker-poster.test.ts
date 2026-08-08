/**
 * Guards the transcode-worker's poster step.
 *
 * The load-bearing case is the LAST describe block: a poster is cosmetic, so a
 * failure to produce one must never fail the job. If it did, BullMQ would burn
 * its retries and the target would end up at `mediaStatus: 'failed'` — a
 * perfectly good video reported as broken and hidden from learners. That is the
 * regression this file exists to prevent.
 *
 * Driven the same way as transcode-worker-encode.test.ts: argv is set, every I/O
 * boundary is mocked and the module is dynamically imported (main() runs at
 * import). ffmpeg is NEVER executed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  fGetObject: vi.fn(),
  fPutObject: vi.fn(),
  lessonUpdate: vi.fn(),
  courseUpdate: vi.fn(),
  disconnect: vi.fn(),
}));

// Node builtins are also consumed via their default export somewhere in the
// import graph, so both shapes have to be provided.
vi.mock('child_process', () => ({
  execFile: mocks.execFile,
  default: { execFile: mocks.execFile },
}));

vi.mock('fs/promises', () => ({
  stat: mocks.stat,
  unlink: mocks.unlink,
  default: { stat: mocks.stat, unlink: mocks.unlink },
}));

vi.mock('minio', () => ({
  Client: function MinioClient(this: Record<string, unknown>) {
    this.fGetObject = mocks.fGetObject;
    this.fPutObject = mocks.fPutObject;
  },
}));

vi.mock('@google-cloud/storage', () => ({
  Storage: function Storage(this: Record<string, unknown>) {},
}));

vi.mock('@/db/index', () => ({
  prisma: {
    lesson: { update: mocks.lessonUpdate },
    course: { update: mocks.courseUpdate },
    $disconnect: mocks.disconnect,
  },
}));

const SOURCE_URI = 'minio://lms-documents/system/videos/raw/source.mov';

const originalArgv = process.argv;

/** Probed duration, in the format ffprobe prints it. */
let probedDuration = '120';

/** When set, the poster ffmpeg pass rejects with this error. */
let posterFfmpegError: Error | null = null;

/** The argv of the poster ffmpeg invocation (the one that asks for one frame). */
function posterArgs(): string[] | undefined {
  const call = (mocks.execFile.mock.calls as unknown[][]).find(
    (c) => c[0] === 'ffmpeg' && (c[1] as string[]).includes('-frames:v'),
  );
  return call?.[1] as string[] | undefined;
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

async function runWorker(targetType: 'lesson' | 'course-preview', targetId: string) {
  process.argv = [
    'node',
    'transcode-worker.ts',
    `--target-type=${targetType}`,
    `--target-id=${targetId}`,
    `--storage-uri=${SOURCE_URI}`,
  ];
  vi.resetModules();
  await import('./transcode-worker');
  const update = targetType === 'lesson' ? mocks.lessonUpdate : mocks.courseUpdate;
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  probedDuration = '120';
  posterFfmpegError = null;

  // The callback is read as the LAST argument, not a fixed position: ffprobe is
  // invoked without an options object, so a fixed (cmd, args, opts, cb) signature
  // silently swallows its callback and every probe resolves as "unknown
  // duration" — which would quietly void the -ss fallback assertion below.
  mocks.execFile.mockImplementation((...callArgs: unknown[]) => {
    const cmd = callArgs[0] as string;
    const args = callArgs[1] as string[];
    const cb = callArgs[callArgs.length - 1] as (e: Error | null, v: unknown) => void;

    if (cmd === 'ffmpeg' && args.includes('-frames:v') && posterFfmpegError) {
      cb(posterFfmpegError, null);
      return;
    }
    // promisify(execFile) resolves with the first callback value, so ffprobe's
    // consumer sees { stdout } exactly as it would from the real implementation.
    cb(null, { stdout: `${probedDuration}\n`, stderr: '' });
  });
  mocks.stat.mockResolvedValue({ size: 1024 });
  mocks.unlink.mockResolvedValue(undefined);
  mocks.fGetObject.mockResolvedValue(undefined);
  mocks.fPutObject.mockResolvedValue(undefined);
  mocks.lessonUpdate.mockResolvedValue({});
  mocks.courseUpdate.mockResolvedValue({});
  mocks.disconnect.mockResolvedValue(undefined);
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

describe('transcode-worker poster generation', () => {
  it('extracts the poster from the normalized output, not the source', async () => {
    await runWorker('lesson', 'lesson-1');

    const args = posterArgs();
    expect(args).toBeDefined();
    // The input is the encode's output file, so the still always matches the
    // video that will actually be delivered.
    expect(valueOf(args!, '-i')).toContain('transcode-out-');
    expect(valueOf(args!, '-frames:v')).toBe('1');
    expect(valueOf(args!, '-vf')).toBe('scale=640:-2');
    expect(valueOf(args!, '-q:v')).toBe('4');
    // `-ss` must precede `-i`: that is an INPUT seek (one keyframe) rather than
    // a full decode up to the offset.
    expect(args!.indexOf('-ss')).toBeLessThan(args!.indexOf('-i'));
    expect(valueOf(args!, '-ss')).toBe('1');
  });

  it('seeks from 0 for a video shorter than two seconds', async () => {
    probedDuration = '1';

    await runWorker('lesson', 'lesson-short');

    expect(valueOf(posterArgs()!, '-ss')).toBe('0');
  });

  it('keeps the normal seek offset when the duration could not be probed', async () => {
    // ffprobe prints nothing parseable — the worker treats duration as unknown.
    probedDuration = 'N/A';

    await runWorker('lesson', 'lesson-unprobed');

    expect(valueOf(posterArgs()!, '-ss')).toBe('1');
  });

  it('uploads the poster as image/jpeg under the posters prefix', async () => {
    await runWorker('lesson', 'lesson-1');

    const posterUpload = mocks.fPutObject.mock.calls.find((c) =>
      String(c[1]).includes('system/videos/posters/'),
    );
    expect(posterUpload).toBeDefined();
    expect(posterUpload![1]).toMatch(/^system\/videos\/posters\/\d+-.+\.jpg$/);
    expect(posterUpload![3]).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('persists the poster URI on the lesson alongside the repointed video', async () => {
    await runWorker('lesson', 'lesson-1');

    expect(mocks.lessonUpdate).toHaveBeenCalledWith({
      where: { id: 'lesson-1' },
      data: expect.objectContaining({
        videoStorageUri: expect.stringContaining('system/videos/normalized/'),
        videoPosterStorageUri: expect.stringContaining('system/videos/posters/'),
        mediaStatus: 'ready',
      }),
    });
  });

  it('persists the poster URI on the course preview', async () => {
    await runWorker('course-preview', 'course-1');

    expect(mocks.courseUpdate).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      data: expect.objectContaining({
        previewVideoStorageUri: expect.stringContaining('system/videos/normalized/'),
        previewPosterStorageUri: expect.stringContaining('system/videos/posters/'),
        previewMediaStatus: 'ready',
      }),
    });
  });
});

describe('transcode-worker poster failure is non-fatal', () => {
  it('still repoints the lesson and reports ready when the poster ffmpeg pass fails', async () => {
    posterFfmpegError = new Error('ffmpeg: could not decode a frame');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    await runWorker('lesson', 'lesson-1');

    const data = mocks.lessonUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.videoStorageUri).toContain('system/videos/normalized/');
    // The whole point: a cosmetic failure must not be reported as broken media.
    expect(data.mediaStatus).toBe('ready');
    // No key at all, so a poster from an earlier run or the backfill survives
    // rather than being overwritten with null.
    expect(data).not.toHaveProperty('videoPosterStorageUri');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('still repoints the course preview when the poster UPLOAD fails', async () => {
    mocks.fPutObject.mockImplementation((_bucket: string, key: string) =>
      key.includes('system/videos/posters/')
        ? Promise.reject(new Error('storage unavailable'))
        : Promise.resolve(undefined),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    await runWorker('course-preview', 'course-1');

    const data = mocks.courseUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.previewVideoStorageUri).toContain('system/videos/normalized/');
    expect(data.previewMediaStatus).toBe('ready');
    expect(data).not.toHaveProperty('previewPosterStorageUri');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('removes the poster temp file even when extraction fails', async () => {
    posterFfmpegError = new Error('boom');
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    await runWorker('lesson', 'lesson-1');

    await vi.waitFor(() =>
      expect(mocks.unlink.mock.calls.some((c) => String(c[0]).includes('transcode-poster-'))).toBe(
        true,
      ),
    );
  });
});
