import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecFile, mockReadFile, mockUnlink, mockGetSignedUrl, mockUploadFile } = vi.hoisted(
  () => ({
    mockExecFile: vi.fn(),
    mockReadFile: vi.fn(),
    mockUnlink: vi.fn(),
    mockGetSignedUrl: vi.fn(),
    mockUploadFile: vi.fn(),
  }),
);

vi.mock('child_process', () => ({
  execFile: mockExecFile,
  default: { execFile: mockExecFile },
}));
vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  unlink: mockUnlink,
  default: { readFile: mockReadFile, unlink: mockUnlink },
}));
vi.mock('@/lib/storage', () => ({
  getSignedUrl: mockGetSignedUrl,
  uploadFile: mockUploadFile,
}));

import { extractAndUploadPoster } from './poster-extraction';

const VIDEO = 'gcs://lms/system/videos/normalized/v.mp4';
const SIGNED = 'https://storage.example/v.mp4?sig=1';

type ExecCall = [string, string[], Record<string, unknown>];

function execSucceeds() {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, out?: unknown) => void;
    cb(null, { stdout: '', stderr: '' });
  });
}

function execCalls(): ExecCall[] {
  return mockExecFile.mock.calls.map((call) => [call[0], call[1], call[2]] as ExecCall);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSignedUrl.mockResolvedValue(SIGNED);
  mockReadFile.mockResolvedValue(Buffer.from('jpeg'));
  mockUnlink.mockResolvedValue(undefined);
  mockUploadFile.mockImplementation((key: string) =>
    Promise.resolve({ storageUri: `gcs://lms/${key}` }),
  );
  execSucceeds();
});

describe('extractAndUploadPoster', () => {
  it('runs ffmpeg under nice against the signed URL and uploads the still', async () => {
    const uri = await extractAndUploadPoster(VIDEO, 120);

    expect(mockGetSignedUrl).toHaveBeenCalledWith(VIDEO, 900);
    const [[cmd, args, options]] = execCalls();
    expect(cmd).toBe('nice');
    expect(args.slice(0, 3)).toEqual(['-n', '19', 'ffmpeg']);
    expect(args).toContain(SIGNED);
    // No timeout unless asked for: the backfill has none.
    expect(options).not.toHaveProperty('timeout');

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/^system\/videos\/posters\/\d+-[0-9a-f-]+\.jpg$/),
      Buffer.from('jpeg'),
      'image/jpeg',
    );
    expect(uri).toMatch(/^gcs:\/\/lms\/system\/videos\/posters\//);
  });

  it('honours a timeout and a key prefix', async () => {
    const uri = await extractAndUploadPoster(VIDEO, null, {
      timeoutMs: 45_000,
      keyPrefix: 'system/videos/thumbnails/c1/',
    });

    expect(execCalls()[0][2]).toMatchObject({ timeout: 45_000 });
    expect(uri).toMatch(/^gcs:\/\/lms\/system\/videos\/thumbnails\/c1\/\d+-/);
  });

  it('falls back to a plain ffmpeg run when nice is missing', async () => {
    mockExecFile.mockImplementationOnce((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error) => void;
      cb(Object.assign(new Error('spawn nice ENOENT'), { code: 'ENOENT' }));
    });

    await extractAndUploadPoster(VIDEO, 120);

    const calls = execCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toBe('ffmpeg');
    expect(calls[1][1]).toContain(SIGNED);
  });

  it('propagates an ffmpeg failure without uploading, and still removes the temp file', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error) => void;
      cb(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }));
    });

    await expect(extractAndUploadPoster(VIDEO, 120, { timeoutMs: 10 })).rejects.toThrow('killed');

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  it('propagates an upload failure and removes the temp file', async () => {
    mockUploadFile.mockRejectedValue(new Error('storage down'));

    await expect(extractAndUploadPoster(VIDEO, 120)).rejects.toThrow('storage down');
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });
});
