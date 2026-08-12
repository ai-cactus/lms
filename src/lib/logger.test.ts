/**
 * Tests for the structured logger's redaction (F-078).
 *
 * The property under test is that PII safety is STRUCTURAL. Before this, a log
 * line was safe only if the developer remembered to call maskEmail — a habit,
 * not a control, and one that fails silently. These tests assert the logger
 * scrubs regardless of what the caller passes.
 *
 * The logger deliberately has no imports (it must load in the browser and the
 * edge runtime), so this suite exercises it through console, which is its
 * transport.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, maskEmail, redactLogPayload } from './logger';

/** Parses the JSON line the production transport emits. */
function emittedEntry(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  return JSON.parse(spy.mock.calls[0][0] as string);
}

describe('maskEmail', () => {
  it('keeps the domain but hides the local part', () => {
    expect(maskEmail('admin@company.com')).toBe('ad***@company.com');
  });

  it('hides a short local part entirely', () => {
    expect(maskEmail('a@x.com')).toBe('***@x.com');
  });

  it('returns a placeholder for a non-address', () => {
    expect(maskEmail('not-an-address')).toBe('***');
  });
});

describe('redactLogPayload — key-based redaction', () => {
  it('blanks secrets matched anywhere in the key', () => {
    const out = redactLogPayload({
      password: 'hunter2',
      newPassword: 'hunter3',
      resetToken: 'abc123',
      AUTHORIZATION: 'Bearer xyz',
      apiKey: 'sk_live_1',
      session_id: 'sid-1',
    });

    for (const value of Object.values(out)) {
      expect(value).toBe('[REDACTED]');
    }
  });

  it('blanks document content and free-text answer fields', () => {
    const out = redactLogPayload({
      content: 'Patient notes...',
      snippet: 'excerpt',
      answers: ['a', 'b'],
      address: '1 Main St',
      phone: '555-0100',
      ssn: '123-45-6789',
      attestationSignature: 'Ada Owner',
    });

    for (const value of Object.values(out)) {
      expect(value).toBe('[REDACTED]');
    }
  });

  /**
   * The reason 'content' is an exact match and not a fragment: the PHI decision
   * ledger logs contentHash and contentLength on purpose, and a greedy rule
   * would scrub exactly the fields that make an incident traceable.
   */
  it('does NOT redact contentHash or contentLength', () => {
    const out = redactLogPayload({
      contentHash: 'a'.repeat(64),
      contentLength: 2048,
      contentType: 'application/pdf',
    });

    expect(out.contentHash).toBe('a'.repeat(64));
    expect(out.contentLength).toBe(2048);
    expect(out.contentType).toBe('application/pdf');
  });

  it('leaves ordinary context fields untouched', () => {
    const out = redactLogPayload({
      userId: 'user-1',
      orgId: 'org-1',
      courseId: 'course-9',
      count: 3,
      ok: true,
      missing: null,
    });

    expect(out).toEqual({
      userId: 'user-1',
      orgId: 'org-1',
      courseId: 'course-9',
      count: 3,
      ok: true,
      missing: null,
    });
  });
});

describe('redactLogPayload — email handling', () => {
  it('masks a value on an email-ish key', () => {
    const out = redactLogPayload({ email: 'admin@company.com', toEmail: 'w@x.com' });

    expect(out.email).toBe('ad***@company.com');
    expect(out.toEmail).toBe('***@x.com');
  });

  // The most common real leak: an address interpolated into a message, where no
  // key-based rule can help.
  it('masks addresses embedded in free text, including msg', () => {
    const out = redactLogPayload({
      msg: 'Invite sent to admin@company.com and ops@other.org',
      note: 'contact person@example.co.uk',
    });

    expect(out.msg).toBe('Invite sent to ad***@company.com and op***@other.org');
    expect(out.note).toBe('contact pe***@example.co.uk');
    expect(JSON.stringify(out)).not.toContain('admin@company.com');
  });
});

describe('redactLogPayload — structural safety', () => {
  it('recurses into nested objects and arrays', () => {
    const out = redactLogPayload({
      outer: { inner: { password: 'x', userId: 'u1' } },
      list: [{ token: 't' }, { safe: 'yes' }],
    });

    const outer = out.outer as { inner: Record<string, unknown> };
    expect(outer.inner.password).toBe('[REDACTED]');
    expect(outer.inner.userId).toBe('u1');

    const list = out.list as Record<string, unknown>[];
    expect(list[0].token).toBe('[REDACTED]');
    expect(list[1].safe).toBe('yes');
  });

  // A logger must never be the thing that takes the process down.
  it('survives a circular reference', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;

    const out = redactLogPayload({ node });

    expect(() => JSON.stringify(out)).not.toThrow();
    expect(JSON.stringify(out)).toContain('[CIRCULAR]');
  });

  it('truncates beyond the depth cap instead of recursing without bound', () => {
    // 10 levels deep, cap is 6.
    let deep: Record<string, unknown> = { bottom: 'reached' };
    for (let i = 0; i < 10; i++) deep = { nest: deep };

    const out = redactLogPayload(deep);

    expect(JSON.stringify(out)).toContain('[TRUNCATED]');
    expect(JSON.stringify(out)).not.toContain('reached');
  });
});

describe('error serialization', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The JSON transport is production-only. stubEnv rather than direct
    // assignment: NODE_ENV is typed read-only.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', 'debug');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('keeps name, message and stack', () => {
    logger.error({ msg: 'boom', err: new Error('it broke') });

    const entry = emittedEntry(errorSpy);
    expect(entry.errName).toBe('Error');
    expect(entry.errMessage).toBe('it broke');
    expect(entry.errStack).toContain('Error: it broke');
  });

  it('keeps allow-listed operational properties', () => {
    const err = Object.assign(new Error('storage failed'), {
      code: 'NoSuchBucket',
      statusCode: 404,
      bucketname: 'lms-documents',
    });

    logger.error({ msg: 'upload failed', err });

    const entry = emittedEntry(errorSpy);
    expect(entry.err_code).toBe('NoSuchBucket');
    expect(entry.err_statusCode).toBe(404);
    expect(entry.err_bucketname).toBe('lms-documents');
  });

  /**
   * The F-078 regression. The old implementation spread every own property as
   * err_*, so an error carrying a token or a request body disclosed it. Now
   * unknown properties are dropped and only their names are reported.
   */
  it('drops non-allow-listed properties but names them', () => {
    const err = Object.assign(new Error('auth failed'), {
      accessToken: 'sk_live_secret',
      requestBody: { password: 'hunter2' },
    });

    logger.error({ msg: 'auth failed', err });

    const entry = emittedEntry(errorSpy);
    const serialized = JSON.stringify(entry);

    expect(serialized).not.toContain('sk_live_secret');
    expect(serialized).not.toContain('hunter2');
    expect(entry.errExtraKeysOmitted).toEqual(['accessToken', 'requestBody']);
  });

  it('masks an address inside an error message', () => {
    logger.error({ msg: 'send failed', err: new Error('no mailbox for a.user@client.com') });

    const entry = emittedEntry(errorSpy);
    expect(entry.errMessage).toBe('no mailbox for a.***@client.com');
  });

  it('redacts a non-Error object thrown as a value', () => {
    logger.error({ msg: 'odd throw', err: { password: 'hunter2', code: 'E1' } });

    const entry = emittedEntry(errorSpy);
    expect(entry.errRaw as string).not.toContain('hunter2');
    expect(entry.errRaw as string).toContain('E1');
  });
});

describe('emit — payload scrubbing end to end', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('scrubs a payload a developer forgot to mask', () => {
    logger.info({
      msg: '[auth] login attempt',
      email: 'admin@company.com',
      password: 'hunter2',
      userId: 'user-1',
    });

    const entry = emittedEntry(infoSpy);
    expect(entry.email).toBe('ad***@company.com');
    expect(entry.password).toBe('[REDACTED]');
    expect(entry.userId).toBe('user-1');
    expect(entry.level).toBe('info');
  });
});
