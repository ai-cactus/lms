/**
 * Unit tests for GCSProvider constructor auth-selection logic.
 *
 * Tests cover:
 *   - Missing GCP_BUCKET_NAME → throws immediately, Storage never constructed
 *   - ADC path (no GCS_KEY_BASE64) → bare Storage() with no args
 *   - In-memory credentials path (valid GCS_KEY_BASE64) → Storage({ projectId, credentials })
 *   - Malformed key variants → warns + throws, no key material in log, Storage never constructed
 *
 * Integration test at the bottom exercises the GCS→MinIO fallback in storage/index.ts.
 * vi.resetModules() is used there to flush the module-level _gcsInitialised singleton.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mock references ──────────────────────────────────────────────────
// Must be constructed before vi.mock() factory bodies run so factories can
// close over them. See project mocking conventions (vi.hoisted pattern).

const MockStorage = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerInfo = vi.hoisted(() => vi.fn());
// Resolved value is set here; vi.clearAllMocks() keeps implementations intact.
const mockMinioUpload = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    storageUri: 'minio://lms-documents/documents/x.pdf',
    backend: 'minio',
  }),
);

// ─── Module mocks (hoisted before any imports of the module under test) ───────

vi.mock('@google-cloud/storage', () => ({
  Storage: MockStorage,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: mockLoggerInfo,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mocked so the integration test never touches a real MinIO server.
// Must use a regular function (not arrow) in mockImplementation so it can be
// called with `new` — arrow functions lack [[Construct]] and throw at runtime.
vi.mock('@/lib/storage/minio-provider', () => ({
  MinIOProvider: vi.fn().mockImplementation(function () {
    return {
      upload: mockMinioUpload,
      getSignedUrl: vi.fn(),
      delete: vi.fn(),
      download: vi.fn(),
    };
  }),
}));

// ─── Module under test (static import — always AFTER vi.mock calls) ───────────
import { GCSProvider } from '@/lib/storage/gcs-provider';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function toBase64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

/** Snapshot / restore process.env around each test so env never leaks. */
function useEnvIsolation() {
  let snapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    snapshot = { ...process.env };
    // Clear storage-related vars so each test starts from a clean slate.
    delete process.env.GCP_BUCKET_NAME;
    delete process.env.GCS_KEY_BASE64;
    delete process.env.GOOGLE_PROJECT_ID;
  });

  afterEach(() => {
    // Remove keys added during the test, then restore originals.
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, snapshot);
  });
}

const VALID_KEY = {
  client_email: 'sa@p.iam.gserviceaccount.com',
  private_key: '-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----',
};

// ─── Constructor unit tests ───────────────────────────────────────────────────

describe('GCSProvider constructor', () => {
  useEnvIsolation();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when GCP_BUCKET_NAME is not set', () => {
    // No env vars set — bucket name is absent.
    expect(() => new GCSProvider()).toThrow(/GCP_BUCKET_NAME is not configured/);
    expect(MockStorage).not.toHaveBeenCalled();
  });

  it('constructs with bare Storage() when GCS_KEY_BASE64 is absent (ADC path)', () => {
    process.env.GCP_BUCKET_NAME = 'my-bucket';
    // GCS_KEY_BASE64 deliberately absent → Application Default Credentials.

    expect(() => new GCSProvider()).not.toThrow();
    expect(MockStorage).toHaveBeenCalledOnce();
    // ADC path passes no options to the Storage constructor.
    expect(MockStorage).toHaveBeenCalledWith();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('constructs with in-memory credentials when GCS_KEY_BASE64 is a valid service-account key', () => {
    process.env.GCP_BUCKET_NAME = 'my-bucket';
    process.env.GCS_KEY_BASE64 = toBase64(VALID_KEY);
    process.env.GOOGLE_PROJECT_ID = 'my-project';

    expect(() => new GCSProvider()).not.toThrow();
    expect(MockStorage).toHaveBeenCalledOnce();
    expect(MockStorage).toHaveBeenCalledWith({
      projectId: 'my-project',
      credentials: {
        client_email: VALID_KEY.client_email,
        private_key: VALID_KEY.private_key,
      },
    });
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('throws and warns when GCS_KEY_BASE64 contains characters that produce non-JSON after base64 decode', () => {
    // Buffer.from with non-base64 chars silently skips them; the resulting bytes
    // form garbage that JSON.parse rejects → falls into the catch block.
    process.env.GCP_BUCKET_NAME = 'my-bucket';
    process.env.GCS_KEY_BASE64 = '!!!not-base64!!!';

    expect(() => new GCSProvider()).toThrow(/GCS_KEY_BASE64 is malformed/);
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    // The raw value must never appear in any logged field (PII / secret hygiene).
    const warnArg = mockLoggerWarn.mock.calls[0][0] as { msg: string };
    expect(warnArg.msg).not.toContain('!!!not-base64!!!');
    expect(MockStorage).not.toHaveBeenCalled();
  });

  it('throws and warns when GCS_KEY_BASE64 is valid base64 but decodes to a non-JSON string', () => {
    process.env.GCP_BUCKET_NAME = 'my-bucket';
    // Encodes "this is not json" in base64 — decodes cleanly, but JSON.parse rejects it.
    process.env.GCS_KEY_BASE64 = Buffer.from('this is not json').toString('base64');

    expect(() => new GCSProvider()).toThrow(/GCS_KEY_BASE64 is malformed/);
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    expect(MockStorage).not.toHaveBeenCalled();
  });

  it('throws and warns when decoded JSON is missing client_email', () => {
    process.env.GCP_BUCKET_NAME = 'my-bucket';
    process.env.GCS_KEY_BASE64 = toBase64({ private_key: 'key' });

    expect(() => new GCSProvider()).toThrow(/GCS_KEY_BASE64 is malformed/);
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    expect(MockStorage).not.toHaveBeenCalled();
  });

  it('throws and warns when decoded JSON is missing private_key', () => {
    process.env.GCP_BUCKET_NAME = 'my-bucket';
    process.env.GCS_KEY_BASE64 = toBase64({ client_email: 'sa@p.com' });

    expect(() => new GCSProvider()).toThrow(/GCS_KEY_BASE64 is malformed/);
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    expect(MockStorage).not.toHaveBeenCalled();
  });
});

// ─── GCSProvider.list ─────────────────────────────────────────────────────────
//
// Tests for the list() method added in the orphaned-object cleanup phase.
// These set up MockStorage to return an instance with a bucket() method.

describe('GCSProvider.list', () => {
  useEnvIsolation();

  const mockGetFiles = vi.fn();
  const mockBucketFn = vi.fn().mockReturnValue({ getFiles: mockGetFiles });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GCP_BUCKET_NAME = 'test-bucket';
    // Give MockStorage a constructor implementation that returns an object
    // with a .bucket() method.  Must use a regular function (not arrow) so
    // that new MockStorage(...) works correctly.
    MockStorage.mockImplementation(function () {
      return { bucket: mockBucketFn };
    });
  });

  it('maps file metadata to StorageListItem with correct gcs:// URIs and createdAt', async () => {
    mockGetFiles.mockResolvedValue([
      [
        {
          name: 'system/videos/lecture.mp4',
          metadata: { timeCreated: '2024-01-15T10:00:00Z' },
        },
        {
          name: 'system/videos/preview.webm',
          metadata: { timeCreated: '2024-03-20T08:30:00Z' },
        },
      ],
    ]);

    const provider = new GCSProvider();
    const result = await provider.list('system/videos/');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      storageUri: 'gcs://test-bucket/system/videos/lecture.mp4',
      createdAt: new Date('2024-01-15T10:00:00Z'),
    });
    expect(result[1]).toEqual({
      storageUri: 'gcs://test-bucket/system/videos/preview.webm',
      createdAt: new Date('2024-03-20T08:30:00Z'),
    });
  });

  it('falls back to a valid Date (not NaN) when timeCreated is absent from metadata', async () => {
    mockGetFiles.mockResolvedValue([[{ name: 'system/videos/no-meta.mp4', metadata: {} }]]);

    const provider = new GCSProvider();
    const result = await provider.list('system/videos/');

    expect(result).toHaveLength(1);
    expect(result[0].createdAt).toBeInstanceOf(Date);
    expect(isNaN(result[0].createdAt.getTime())).toBe(false);
  });

  it('returns an empty array when getFiles resolves with no files', async () => {
    mockGetFiles.mockResolvedValue([[]]);

    const provider = new GCSProvider();
    const result = await provider.list('system/videos/');

    expect(result).toHaveLength(0);
  });

  it('passes the prefix to getFiles', async () => {
    mockGetFiles.mockResolvedValue([[]]);

    const provider = new GCSProvider();
    await provider.list('system/videos/normalized/');

    expect(mockGetFiles).toHaveBeenCalledWith({ prefix: 'system/videos/normalized/' });
  });
});

// ─── Integration: GCS→MinIO fallback via storage/index.ts ─────────────────────
//
// index.ts memoises GCS init behind a module-level _gcsInitialised flag.
// vi.resetModules() is used to flush that singleton before each test here so
// the fallback path can be exercised deterministically.

describe('storage/index: GCS→MinIO fallback', () => {
  useEnvIsolation();

  beforeEach(() => {
    vi.clearAllMocks();
    // Flush the module registry so the _gcsInitialised singleton resets.
    // The dynamic import inside each test gets a fresh module evaluation.
    vi.resetModules();
  });

  it('falls back to MinIO and returns a minio:// URI when GCS init throws', async () => {
    process.env.GCP_BUCKET_NAME = 'my-bucket';
    // Valid base64 that decodes to non-JSON → GCSProvider constructor throws →
    // tryGetGCS() catches it and returns null → uploadFile uses MinIO.
    process.env.GCS_KEY_BASE64 = Buffer.from('not-valid-json').toString('base64');

    // Dynamic import after resetModules() gets a freshly evaluated index.ts.
    const { uploadFile } = await import('@/lib/storage/index');
    const result = await uploadFile('documents/x.pdf', Buffer.from('x'), 'application/pdf');

    expect(result.storageUri).toMatch(/^minio:\/\//);
    expect(mockMinioUpload).toHaveBeenCalledOnce();
    expect(mockMinioUpload).toHaveBeenCalledWith(
      'documents/x.pdf',
      Buffer.from('x'),
      'application/pdf',
    );
  });
});
