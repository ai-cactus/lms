/**
 * Regression tests for Bug 2: the transcode-worker's getGcs() credential-decode logic.
 *
 * WHY the worker is not imported directly:
 *   scripts/transcode-worker.ts calls `main()` at module level. Importing it would
 *   run `main()`, which would fail in the test environment (no real FFmpeg/storage)
 *   and would eagerly construct the shared Prisma client. Neither is desirable in a
 *   focused unit test, so the credential logic is exercised via a replica below.
 *   The exception is the secret-hygiene test at the end: the replica has no log
 *   calls, so that property can only be checked on the real worker, which it
 *   imports with every I/O boundary mocked (as transcode-worker-encode.test.ts does).
 *
 * APPROACH — replicated algorithm:
 *   The worker's getGcs() comment explicitly states it "Mirrors GCSProvider in
 *   src/lib/storage/gcs-provider.ts". The authoritative tests for the shared decode+validate
 *   algorithm live in src/lib/storage/gcs-provider.test.ts (valid key / ADC / malformed /
 *   missing fields). This file guards the worker-specific implementation inline:
 *   the replicated function below is a verbatim copy of the getGcs() credential block.
 *   If the worker's logic diverges from these tests, that divergence is itself a red flag.
 *
 * TO ACHIEVE DIRECT COVERAGE of getGcs():
 *   The worker would need to export getGcs(), or the credential logic would need to be
 *   extracted into a shared utility module. Either change is a product-code refactor — see
 *   the orchestrator's notes for follow-up.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// I/O boundaries for the one test below that runs the REAL worker. The
// replicated-algorithm tests above it never import the worker, so these mocks
// are inert for them. Node builtins need a `default` export too.
const workerMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  gcsCtor: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('child_process', () => ({
  execFile: workerMocks.execFile,
  default: { execFile: workerMocks.execFile },
}));
vi.mock('fs/promises', () => ({
  stat: workerMocks.stat,
  unlink: workerMocks.unlink,
  default: { stat: workerMocks.stat, unlink: workerMocks.unlink },
}));
vi.mock('minio', () => ({ Client: function MinioClient() {} }));
vi.mock('@google-cloud/storage', () => ({
  Storage: function Storage(...args: unknown[]) {
    workerMocks.gcsCtor(...args);
  },
}));
vi.mock('@/db/index', () => ({ prisma: { $disconnect: workerMocks.disconnect } }));

// ── Types ─────────────────────────────────────────────────────────────────────

type StorageCtor = new (...args: unknown[]) => unknown;

// ── Replicated algorithm ──────────────────────────────────────────────────────
//
// Verbatim copy of the credential-handling block inside getGcs() in
// scripts/transcode-worker.ts. Update this function IN LOCKSTEP with the worker
// whenever the worker's getGcs() logic changes.

function replicatedGetGcs(rawKey: string | undefined, StorageCtorArg: StorageCtor): unknown {
  if (rawKey) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8'));
    } catch {
      // Worker logs here: log('error', '[transcode-worker] GCS_KEY_BASE64 is malformed...')
      // then throws — we omit the log call so the test stays self-contained.
      throw new Error('GCS_KEY_BASE64 is malformed');
    }

    const p = parsed as Record<string, unknown>;
    if (
      typeof p?.client_email !== 'string' ||
      !p.client_email ||
      typeof p?.private_key !== 'string' ||
      !p.private_key
    ) {
      // Worker logs here too before throwing.
      throw new Error('GCS_KEY_BASE64 is missing required service-account fields');
    }

    return new StorageCtorArg({
      projectId: process.env.GOOGLE_PROJECT_ID,
      credentials: {
        client_email: p.client_email as string,
        private_key: p.private_key as string,
      },
    });
  }

  // Absent key → ADC: bare Storage() with no args.
  return new StorageCtorArg();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBase64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

const VALID_KEY = {
  client_email: 'sa@test.iam.gserviceaccount.com',
  private_key: '-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getGcs() credential-decode algorithm [Bug 2 regression — replicated logic]', () => {
  let MockStorageCtor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Regular function (not arrow) so it can be called with `new` without throwing.
    // See project memory: constructor mock must use regular function.
    MockStorageCtor = vi.fn().mockImplementation(function () {});
    delete process.env.GOOGLE_PROJECT_ID;
  });

  it('constructs Storage with in-memory credentials when GCS_KEY_BASE64 is a valid service-account key', () => {
    replicatedGetGcs(toBase64(VALID_KEY), MockStorageCtor as unknown as StorageCtor);

    expect(MockStorageCtor).toHaveBeenCalledOnce();
    expect(MockStorageCtor).toHaveBeenCalledWith({
      projectId: undefined, // GOOGLE_PROJECT_ID not set in this test
      credentials: {
        client_email: VALID_KEY.client_email,
        private_key: VALID_KEY.private_key,
      },
    });
  });

  it('includes GOOGLE_PROJECT_ID in the Storage options when the env var is set', () => {
    process.env.GOOGLE_PROJECT_ID = 'my-test-project';
    replicatedGetGcs(toBase64(VALID_KEY), MockStorageCtor as unknown as StorageCtor);

    expect(MockStorageCtor).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'my-test-project' }),
    );
  });

  it('constructs bare Storage() with no args when GCS_KEY_BASE64 is absent (ADC path)', () => {
    replicatedGetGcs(undefined, MockStorageCtor as unknown as StorageCtor);

    expect(MockStorageCtor).toHaveBeenCalledOnce();
    // ADC path must pass NO arguments — the Storage client auto-resolves via gcloud auth /
    // GOOGLE_APPLICATION_CREDENTIALS / VM service account.
    expect(MockStorageCtor).toHaveBeenCalledWith();
  });

  it('throws for a valid base64 string that decodes to non-JSON', () => {
    const malformedKey = Buffer.from('this is not json').toString('base64');

    expect(() => replicatedGetGcs(malformedKey, MockStorageCtor as unknown as StorageCtor)).toThrow(
      /GCS_KEY_BASE64 is malformed/,
    );

    // Storage must never be constructed when the key cannot be parsed.
    expect(MockStorageCtor).not.toHaveBeenCalled();
  });

  it('throws for characters that produce garbage bytes on base64 decode (non-JSON)', () => {
    // Buffer.from with non-base64 chars silently skips them — the resulting bytes are
    // unlikely to form valid JSON, so JSON.parse rejects them.
    expect(() =>
      replicatedGetGcs('!!!NOT-VALID-BASE64-OR-JSON!!!', MockStorageCtor as unknown as StorageCtor),
    ).toThrow(/GCS_KEY_BASE64 is malformed/);

    expect(MockStorageCtor).not.toHaveBeenCalled();
  });

  it('throws when the decoded JSON is missing client_email', () => {
    expect(() =>
      replicatedGetGcs(
        toBase64({ private_key: VALID_KEY.private_key }),
        MockStorageCtor as unknown as StorageCtor,
      ),
    ).toThrow(/missing required service-account fields/);

    expect(MockStorageCtor).not.toHaveBeenCalled();
  });

  it('throws when the decoded JSON is missing private_key', () => {
    expect(() =>
      replicatedGetGcs(
        toBase64({ client_email: VALID_KEY.client_email }),
        MockStorageCtor as unknown as StorageCtor,
      ),
    ).toThrow(/missing required service-account fields/);

    expect(MockStorageCtor).not.toHaveBeenCalled();
  });

  it('throws when client_email is an empty string', () => {
    expect(() =>
      replicatedGetGcs(
        toBase64({ client_email: '', private_key: VALID_KEY.private_key }),
        MockStorageCtor as unknown as StorageCtor,
      ),
    ).toThrow();

    expect(MockStorageCtor).not.toHaveBeenCalled();
  });

  it('throws when private_key is an empty string', () => {
    expect(() =>
      replicatedGetGcs(
        toBase64({ client_email: VALID_KEY.client_email, private_key: '' }),
        MockStorageCtor as unknown as StorageCtor,
      ),
    ).toThrow();

    expect(MockStorageCtor).not.toHaveBeenCalled();
  });
});

// ── Secret hygiene, on the REAL worker ───────────────────────────────────────
// The worker writes JSON lines to process.stdout (and its fatal line to
// process.stderr). This drives the actual
// scripts/transcode-worker.ts getGcs() failure path (a gcs:// download with a
// malformed GCS_KEY_BASE64) and asserts the key never reaches any log line —
// neither the base64 value nor the decoded text. (It replaced a test that ran
// the log-free replica above, and so could never have failed.)
describe('transcode-worker — a malformed GCS_KEY_BASE64 is never logged', () => {
  const SECRET = 'SENSITIVE-KEY-VALUE-MUST-NOT-APPEAR-IN-LOG';
  const originalArgv = process.argv;
  const originalKey = process.env.GCS_KEY_BASE64;

  afterEach(() => {
    process.argv = originalArgv;
    if (originalKey === undefined) delete process.env.GCS_KEY_BASE64;
    else process.env.GCS_KEY_BASE64 = originalKey;
    vi.restoreAllMocks();
  });

  it('fails the run with a generic message and no trace of the key', async () => {
    const encoded = Buffer.from(`{not json ${SECRET}`).toString('base64');
    process.env.GCS_KEY_BASE64 = encoded;
    process.argv = [
      'node',
      'transcode-worker.ts',
      '--target-type=lesson',
      '--target-id=lesson-1',
      '--storage-uri=gcs://bucket/system/videos/raw/source.mov',
    ];
    workerMocks.unlink.mockResolvedValue(undefined);
    workerMocks.disconnect.mockResolvedValue(undefined);
    const written: string[] = [];
    const capture = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture as typeof process.stderr.write);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    vi.resetModules();
    await import('./transcode-worker');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));

    const allLogs = written.join('');
    // The real path ran: the malformed-key branch logged, then main() failed.
    expect(allLogs).toContain('GCS_KEY_BASE64 is malformed (decode/parse failed)');
    expect(allLogs).toContain('[transcode-worker] Fatal');
    expect(allLogs).not.toContain(SECRET);
    expect(allLogs).not.toContain(encoded);
    expect(workerMocks.gcsCtor).not.toHaveBeenCalled();
  });
});
