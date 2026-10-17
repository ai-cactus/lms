/**
 * Unit tests for src/lib/onboarding/document-storage.ts — the single ownership
 * rule for compliance documents parked under `onboarding/{userId}/` before the
 * founder's organization exists (SEC-20).
 */
import { describe, it, expect } from 'vitest';

import {
  isOwnOnboardingDocumentUri,
  isOwnOnboardingStorageKey,
  onboardingStoragePrefix,
} from './document-storage';

describe('onboardingStoragePrefix', () => {
  it('builds the per-user prefix with a trailing slash', () => {
    expect(onboardingStoragePrefix('user-1')).toBe('onboarding/user-1/');
  });
});

describe('isOwnOnboardingStorageKey', () => {
  it('accepts a key under the caller’s own prefix', () => {
    expect(isOwnOnboardingStorageKey('onboarding/user-1/123-cert.pdf', 'user-1')).toBe(true);
  });

  it('rejects a key under a different user’s prefix', () => {
    expect(isOwnOnboardingStorageKey('onboarding/user-2/123-cert.pdf', 'user-1')).toBe(false);
  });

  it('rejects a prefix-of-another-id key (`onboarding/{id}x/...`)', () => {
    expect(isOwnOnboardingStorageKey('onboarding/user-1x/123-cert.pdf', 'user-1')).toBe(false);
  });

  it('rejects the bare prefix and the prefix without its trailing slash', () => {
    expect(isOwnOnboardingStorageKey('onboarding/user-1/', 'user-1')).toBe(false);
    expect(isOwnOnboardingStorageKey('onboarding/user-1', 'user-1')).toBe(false);
  });

  it('rejects keys outside the onboarding area entirely', () => {
    expect(isOwnOnboardingStorageKey('organizations/org-1/compliance/1-a.pdf', 'user-1')).toBe(
      false,
    );
    expect(isOwnOnboardingStorageKey('xonboarding/user-1/1-a.pdf', 'user-1')).toBe(false);
  });

  it.each([
    'onboarding/user-1/../user-2/123-cert.pdf',
    'onboarding/user-1/../../organizations/org-9/compliance/1-a.pdf',
    'onboarding/user-1/./123-cert.pdf',
    'onboarding/user-1/..',
  ])('rejects a dot-segment key that could escape the prefix: %s', (key) => {
    expect(isOwnOnboardingStorageKey(key, 'user-1')).toBe(false);
  });

  it('accepts dots that are part of a segment rather than a whole segment', () => {
    expect(isOwnOnboardingStorageKey('onboarding/user-1/123-..pdf', 'user-1')).toBe(true);
  });

  it.each([null, undefined, ''])('rejects every key when the user id is %p', (userId) => {
    expect(isOwnOnboardingStorageKey('onboarding//123-cert.pdf', userId)).toBe(false);
    expect(isOwnOnboardingStorageKey('onboarding/user-1/123-cert.pdf', userId)).toBe(false);
  });
});

describe('isOwnOnboardingDocumentUri', () => {
  it.each([
    'gcs://lms-bucket/onboarding/user-1/1-cert.pdf',
    'minio://lms-documents/onboarding/user-1/1-cert.pdf',
  ])('accepts a storage URI whose key is under the caller’s prefix: %s', (uri) => {
    expect(isOwnOnboardingDocumentUri(uri, 'user-1')).toBe(true);
  });

  it.each([
    ['another user’s prefix', 'gcs://lms-bucket/onboarding/user-2/1-cert.pdf'],
    ['an organization object', 'gcs://lms-bucket/organizations/org-1/compliance/1-a.pdf'],
    ['a traversal out of the prefix', 'gcs://lms-bucket/onboarding/user-1/../user-2/1-cert.pdf'],
    ['an unknown scheme', 's3://lms-bucket/onboarding/user-1/1-cert.pdf'],
    ['a plain https URL', 'https://evil.example/onboarding/user-1/1-cert.pdf'],
    ['a legacy local path', '/uploads/onboarding/user-1/1-cert.pdf'],
    ['a bucket with no key', 'gcs://lms-bucket/'],
    ['a garbage string', 'not a uri'],
    ['an empty string', ''],
  ])('rejects %s', (_label, uri) => {
    expect(isOwnOnboardingDocumentUri(uri, 'user-1')).toBe(false);
  });

  it.each([undefined, null, 42, {}, ['gcs://b/onboarding/user-1/1.pdf']])(
    'rejects a non-string value (%p) instead of throwing',
    (value) => {
      expect(isOwnOnboardingDocumentUri(value, 'user-1')).toBe(false);
    },
  );
});
