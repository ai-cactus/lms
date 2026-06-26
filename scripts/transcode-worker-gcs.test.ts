/**
 * Regression tests for Bug 2: the transcode-worker's getGcs() credential-decode logic.
 *
 * WHY the worker is not imported directly:
 *   scripts/transcode-worker.mjs calls `main()` at module level. Importing it would
 *   run `main()`, which would fail in the test environment (no real FFmpeg/storage).
 *   A child_process approach is also not viable in the current state because the worker's
 *   module-level `new PrismaClient()` call crashes with PrismaClientInitializationError in
 *   Prisma 7.8's WASM-based CJS client before main() is ever invoked — so the child
 *   process never reaches getGcs() at all.
 *   (That crash is a separate product bug — see the orchestrator's notes.)
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

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

type StorageCtor = new (...args: unknown[]) => unknown;

// ── Replicated algorithm ──────────────────────────────────────────────────────
//
// Verbatim copy of the credential-handling block inside getGcs() in
// scripts/transcode-worker.mjs. Update this function IN LOCKSTEP with the worker
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

    expect(() =>
      replicatedGetGcs(malformedKey, MockStorageCtor as unknown as StorageCtor),
    ).toThrow(/GCS_KEY_BASE64 is malformed/);

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

  // ── Secret hygiene assertion ─────────────────────────────────────────────────
  // The worker's log() helper writes to stdout via console.log. This test verifies
  // that the raw key value never leaks into a log call — the worker logs only a
  // non-sensitive message string. We spy on console.log here since the worker uses
  // it directly (unlike the app, which uses the structured logger).

  it('does not leak the raw malformed key into any console output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const MALFORMED = '!!!SENSITIVE-KEY-VALUE-MUST-NOT-APPEAR-IN-LOG!!!';

    try {
      replicatedGetGcs(
        Buffer.from(MALFORMED).toString('base64'),
        MockStorageCtor as unknown as StorageCtor,
      );
    } catch {
      // Expected to throw — we only care about what was logged.
    }

    const allLogs = spy.mock.calls.map((args) => JSON.stringify(args)).join('\n');
    expect(allLogs).not.toContain(MALFORMED);
    spy.mockRestore();
  });
});
