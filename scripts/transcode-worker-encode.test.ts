/**
 * Integration guards for the transcode-worker's encode + stamping behavior.
 *
 * scripts/transcode-worker.ts runs main() at module level and reads process.argv,
 * so it is driven here by setting argv, mocking every I/O boundary (child_process,
 * fs, storage clients, Prisma) and dynamically importing the module. ffmpeg is
 * NEVER executed — only the argv it would have been handed is asserted.
 *
 * What this pins:
 *   - the normalization profile actually reaches ffmpeg (not just the builder),
 *   - VIDEO_* env knobs flow through the worker into that argv,
 *   - both write paths stamp the encode generation, which is the only way an
 *     un-migrated asset can later be identified for a backfill.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VIDEO_ENCODING_VERSION } from '@/lib/video/encoding';

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
  // Regular function so it is constructible with `new`.
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

/** The scale filter the default caps produce, on its own (no frame-rate cap). */
const SCALE_1280x720 =
  "scale=w='min(1280,iw)':h='min(720,ih)'" +
  ':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos';

/** Every VIDEO_* knob, so one test's override cannot leak into the next. */
const ENCODE_ENV_VARS = [
  'VIDEO_MAX_WIDTH',
  'VIDEO_MAX_HEIGHT',
  'VIDEO_MAX_FPS',
  'VIDEO_CRF',
  'VIDEO_MAXRATE',
  'VIDEO_PRESET',
] as const;

const originalArgv = process.argv;
const originalEnv: Partial<Record<string, string | undefined>> = {};

/**
 * Sets argv, imports the worker, and waits for main() to reach its DB write.
 * main() is fired at import time and never awaited by the module, so the write
 * assertion is what tells us the run finished.
 */
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

/** The argv of the ffmpeg (not ffprobe) invocation. */
function ffmpegArgs(): string[] {
  const call = mocks.execFile.mock.calls.find((c) => c[0] === 'ffmpeg');
  if (!call) throw new Error('ffmpeg was never invoked');
  return call[1] as string[];
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe('transcode-worker encode + encoding-version stamping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    for (const key of ENCODE_ENV_VARS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }

    // promisify(execFile) resolves with the first callback value, so ffprobe's
    // consumer sees { stdout } exactly as it would from the real custom promisify.
    // The two ffprobe calls ask for different entries, so they are answered by
    // what they requested: seconds of duration vs. an avg_frame_rate rational.
    // The callback is taken as the LAST argument, not a fixed position: the
    // ffprobe calls pass no options object, so a 4-parameter signature would
    // silently never answer them.
    mocks.execFile.mockImplementation((cmd: string, args: string[], ...rest: unknown[]) => {
      const cb = rest.at(-1) as (e: Error | null, v: unknown) => void;
      const wantsFrameRate = cmd === 'ffprobe' && args.includes('stream=avg_frame_rate');
      cb(null, { stdout: wantsFrameRate ? '60/1\n' : '120\n', stderr: '' });
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
    for (const key of ENCODE_ENV_VARS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    vi.restoreAllMocks();
  });

  it('hands ffmpeg the default normalization profile', async () => {
    await runWorker('lesson', 'lesson-1');

    const args = ffmpegArgs();
    // The source probes at 60fps, so the cap engages ahead of the scale.
    expect(valueOf(args, '-vf')).toBe(`fps=30,${SCALE_1280x720}`);
    expect(valueOf(args, '-level')).toBe('3.1');
    expect(valueOf(args, '-crf')).toBe('23');
    expect(valueOf(args, '-preset')).toBe('fast');
    expect(valueOf(args, '-maxrate')).toBe('2500k');
    expect(valueOf(args, '-bufsize')).toBe('5000k');
    expect(valueOf(args, '-g')).toBe('48');
    expect(valueOf(args, '-keyint_min')).toBe('48');
    expect(valueOf(args, '-sc_threshold')).toBe('0');
    expect(valueOf(args, '-threads')).toBe('1');
    expect(valueOf(args, '-b:a')).toBe('96k');
  });

  it('applies the VIDEO_* env overrides to the ffmpeg argv', async () => {
    process.env.VIDEO_MAX_WIDTH = '1920';
    process.env.VIDEO_MAX_HEIGHT = '1080';
    process.env.VIDEO_MAX_FPS = '24';
    process.env.VIDEO_CRF = '21';
    process.env.VIDEO_MAXRATE = '4500k';
    process.env.VIDEO_PRESET = 'medium';

    await runWorker('lesson', 'lesson-1');

    const args = ffmpegArgs();
    expect(valueOf(args, '-vf')).toBe(
      "fps=24,scale=w='min(1920,iw)':h='min(1080,ih)'" +
        ':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos',
    );
    expect(valueOf(args, '-crf')).toBe('21');
    expect(valueOf(args, '-maxrate')).toBe('4500k');
    expect(valueOf(args, '-bufsize')).toBe('9000k');
    expect(valueOf(args, '-preset')).toBe('medium');
  });

  it('falls back to the defaults when the env overrides are malformed', async () => {
    process.env.VIDEO_MAX_WIDTH = 'not-a-number';
    process.env.VIDEO_MAX_HEIGHT = '721';
    process.env.VIDEO_MAX_FPS = '0';
    process.env.VIDEO_CRF = '99';
    process.env.VIDEO_MAXRATE = '2500';
    process.env.VIDEO_PRESET = 'turbo';

    await runWorker('lesson', 'lesson-1');

    const args = ffmpegArgs();
    expect(valueOf(args, '-vf')).toBe(`fps=30,${SCALE_1280x720}`);
    expect(valueOf(args, '-crf')).toBe('23');
    expect(valueOf(args, '-maxrate')).toBe('2500k');
    expect(valueOf(args, '-preset')).toBe('fast');
  });

  it('stamps the encode generation on the lesson alongside the repointed URI', async () => {
    await runWorker('lesson', 'lesson-1');

    expect(mocks.lessonUpdate).toHaveBeenCalledWith({
      where: { id: 'lesson-1' },
      data: expect.objectContaining({
        videoEncodingVersion: VIDEO_ENCODING_VERSION,
        videoProvider: 'self',
        mediaStatus: 'ready',
        videoStorageUri: expect.stringContaining('system/videos/normalized/'),
      }),
    });
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
  });

  it('stamps the encode generation on the course preview video', async () => {
    await runWorker('course-preview', 'course-1');

    expect(mocks.courseUpdate).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      data: expect.objectContaining({
        previewVideoEncodingVersion: VIDEO_ENCODING_VERSION,
        previewMediaStatus: 'ready',
        previewVideoStorageUri: expect.stringContaining('system/videos/normalized/'),
      }),
    });
    expect(mocks.lessonUpdate).not.toHaveBeenCalled();
  });
});
