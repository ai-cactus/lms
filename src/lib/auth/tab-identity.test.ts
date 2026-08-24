/**
 * Unit tests for the per-tab identity baseline that backs the session-isolation
 * guard (see SessionIdentityGuard). `sessionStorage` is scoped to a single
 * browser tab, so recording which account a tab first rendered as lets it
 * detect when the shared session cookie has since been overwritten by a
 * DIFFERENT account signing in elsewhere in the same browser.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TAB_IDENTITY_KEY,
  readTabIdentity,
  writeTabIdentity,
  clearTabIdentity,
  checkTabIdentity,
  checkLiveTabIdentity,
} from './tab-identity';

describe('checkTabIdentity', () => {
  it('returns "first-sight" when the tab has recorded nothing yet', () => {
    expect(checkTabIdentity(null, 'user-1')).toBe('first-sight');
  });

  it('returns "match" when the recorded userId equals the current session userId', () => {
    expect(checkTabIdentity({ userId: 'user-1', name: 'Alice' }, 'user-1')).toBe('match');
  });

  it('returns "mismatch" when the recorded userId differs from the current session userId', () => {
    expect(checkTabIdentity({ userId: 'user-1', name: 'Alice' }, 'user-2')).toBe('mismatch');
  });
});

describe('checkLiveTabIdentity', () => {
  it('returns "unknown" when the tab has recorded nothing yet — never establishes a baseline itself', () => {
    expect(checkLiveTabIdentity(null, 'user-1')).toBe('unknown');
  });

  it('returns "unknown" (not "match") when nothing is recorded, even if a live user id is present', () => {
    // The prop-based `evaluate()` owns the first-sight -> baseline transition;
    // the live check must never race ahead of it and silently adopt a baseline.
    expect(checkLiveTabIdentity(null, null)).toBe('unknown');
  });

  it('returns "match" when the recorded userId equals the live session userId', () => {
    expect(checkLiveTabIdentity({ userId: 'user-1', name: 'Alice' }, 'user-1')).toBe('match');
  });

  it('returns "mismatch" when the recorded userId differs from the live session userId', () => {
    expect(checkLiveTabIdentity({ userId: 'user-1', name: 'Alice' }, 'user-2')).toBe('mismatch');
  });

  // "mismatch" requires POSITIVE evidence of a different account: a recorded
  // baseline AND a present live id that differs from it. An absent live id is
  // NOT proof of a takeover — under CPU contention the on-focus
  // `/api/auth/session` refetch can momentarily return empty for a
  // still-valid session, and that must never evict a legitimate tab. This is
  // the exact hardening that fixed the ~15% batch-only false-eviction flake
  // in session-active-org-isolation.spec.ts.
  it('returns "unknown" (not "mismatch") when the live user id is null — an absent live id is not proof of a takeover', () => {
    expect(checkLiveTabIdentity({ userId: 'user-1', name: 'Alice' }, null)).toBe('unknown');
  });

  it('returns "unknown" (not "mismatch") when the live user id is undefined', () => {
    expect(checkLiveTabIdentity({ userId: 'user-1', name: 'Alice' }, undefined)).toBe('unknown');
  });

  it('returns "unknown" (not "mismatch") when the live user id is an empty string', () => {
    expect(checkLiveTabIdentity({ userId: 'user-1', name: 'Alice' }, '')).toBe('unknown');
  });
});

describe('sessionStorage round-trip (readTabIdentity / writeTabIdentity / clearTabIdentity)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns null when nothing has been written', () => {
    expect(readTabIdentity()).toBeNull();
  });

  it('round-trips a written identity back out unchanged', () => {
    writeTabIdentity({ userId: 'user-1', name: 'Alice Anderson' });

    expect(readTabIdentity()).toEqual({ userId: 'user-1', name: 'Alice Anderson' });
  });

  it('writes under the documented sessionStorage key', () => {
    writeTabIdentity({ userId: 'user-1', name: 'Alice' });

    const raw = sessionStorage.getItem(TAB_IDENTITY_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ userId: 'user-1', name: 'Alice' });
  });

  it('overwrites a previously recorded identity with a later write', () => {
    writeTabIdentity({ userId: 'user-1', name: 'Alice' });
    writeTabIdentity({ userId: 'user-2', name: 'Bob' });

    expect(readTabIdentity()).toEqual({ userId: 'user-2', name: 'Bob' });
  });

  it('clearTabIdentity removes the recorded identity', () => {
    writeTabIdentity({ userId: 'user-1', name: 'Alice' });
    clearTabIdentity();

    expect(readTabIdentity()).toBeNull();
  });

  it('treats malformed JSON as no recorded identity (degrades to first-sight) rather than throwing', () => {
    sessionStorage.setItem(TAB_IDENTITY_KEY, '{not valid json');

    expect(() => readTabIdentity()).not.toThrow();
    expect(readTabIdentity()).toBeNull();
  });

  it('treats a structurally invalid stored value (missing fields) as no recorded identity', () => {
    sessionStorage.setItem(TAB_IDENTITY_KEY, JSON.stringify({ userId: 'user-1' }));

    expect(readTabIdentity()).toBeNull();
  });

  it('treats a stored non-string userId as no recorded identity', () => {
    sessionStorage.setItem(TAB_IDENTITY_KEY, JSON.stringify({ userId: 42, name: 'Alice' }));

    expect(readTabIdentity()).toBeNull();
  });

  it('degrades to a no-op (never throws) when sessionStorage.getItem throws (private mode / disabled)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: sessionStorage disabled');
    });

    expect(() => readTabIdentity()).not.toThrow();
    expect(readTabIdentity()).toBeNull();

    spy.mockRestore();
  });

  it('degrades to a no-op (never throws) when sessionStorage.setItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => writeTabIdentity({ userId: 'user-1', name: 'Alice' })).not.toThrow();

    spy.mockRestore();
  });

  it('degrades to a no-op (never throws) when sessionStorage.removeItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => clearTabIdentity()).not.toThrow();

    spy.mockRestore();
  });
});
