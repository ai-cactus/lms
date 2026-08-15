/**
 * These tests are the contract that keeps PHI, credentials and direct
 * identifiers out of PostHog. Treat a failure here as a security regression,
 * not a broken unit test.
 */
import { describe, it, expect } from 'vitest';
import { normalizePath, sanitizeProperties, sanitizeErrorText } from './sanitize';

const UUID = '3f2b8c1e-4a5d-4b7e-9c0f-1a2b3c4d5e6f';

describe('normalizePath', () => {
  it('reduces a UUID segment to a placeholder', () => {
    expect(normalizePath(`/learn/${UUID}`)).toBe('/learn/[id]');
    expect(normalizePath(`/dashboard/courses/${UUID}`)).toBe('/dashboard/courses/[id]');
  });

  it('keeps static segments either side of a dynamic one', () => {
    expect(normalizePath(`/dashboard/courses/${UUID}/edit`)).toBe('/dashboard/courses/[id]/edit');
  });

  // The invite token IS a credential — anyone holding it can join the org.
  it('scrubs the invite token at /join', () => {
    expect(normalizePath('/join/PkS8x2Lm9QvT4nR7wZ3bYc1d')).toBe('/join/[token]');
  });

  // Shape detection alone would miss this; the /join prefix rule is what saves it.
  it('scrubs a short invite token that no shape heuristic would catch', () => {
    expect(normalizePath('/join/abc123')).toBe('/join/[token]');
  });

  it('scrubs the certificate id on the public verification route', () => {
    expect(normalizePath(`/verify-certificate/${UUID}`)).toBe('/verify-certificate/[id]');
  });

  it('scrubs numeric ids', () => {
    expect(normalizePath('/dashboard/staff/40718')).toBe('/dashboard/staff/[id]');
  });

  it('drops the query string wholesale', () => {
    expect(normalizePath('/dashboard?email=nurse@clinic.com&orgId=7')).toBe('/dashboard');
  });

  it('drops the fragment', () => {
    expect(normalizePath('/worker/trainings#module-2')).toBe('/worker/trainings');
  });

  it('accepts a full URL and returns only the route shape', () => {
    expect(normalizePath(`https://app.theraptly.com/learn/${UUID}?t=9`)).toBe('/learn/[id]');
  });

  it('leaves a fully static path untouched', () => {
    expect(normalizePath('/dashboard/audit-reports')).toBe('/dashboard/audit-reports');
  });

  // Regression: long kebab-case route names are longer than the token length
  // floor and were briefly scrubbed as credentials, collapsing distinct pages
  // into a single meaningless funnel step.
  it.each([
    '/verify-certificate',
    '/select-organization',
    '/onboarding-worker',
    '/dashboard/status-tracker',
    '/worker/notifications',
    '/forgot-password',
  ])('keeps the long static route name %s intact', (path) => {
    expect(normalizePath(path)).toBe(path);
  });

  it('still scrubs a mixed-case token that is not a route name', () => {
    expect(normalizePath('/some-future-route/PkS8x2Lm9QvT4nR7wZ3b')).toBe(
      '/some-future-route/[token]',
    );
  });

  it('handles the root path and empty input', () => {
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });
});

describe('sanitizeProperties', () => {
  it('passes primitives through unchanged', () => {
    expect(sanitizeProperties({ courseId: 'c1', score: 82, passed: true })).toEqual({
      courseId: 'c1',
      score: 82,
      passed: true,
    });
  });

  it('masks an email supplied under an email-ish key', () => {
    const out = sanitizeProperties({ email: 'nurse@clinic.com' });
    expect(out.email).toBe('nu***@clinic.com');
  });

  it('masks an email interpolated into free text', () => {
    const out = sanitizeProperties({ reason: 'invite for nurse@clinic.com bounced' });
    expect(out.reason).not.toContain('nurse@clinic.com');
    expect(out.reason).toContain('***@clinic.com');
  });

  it('redacts sensitive keys outright', () => {
    const out = sanitizeProperties({ token: 'PkS8x2Lm9QvT4nR7', password: 'hunter2' });
    expect(out.token).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
  });

  // Objects and arrays are how free text — i.e. clinical course content — would
  // smuggle itself out. They are dropped, never serialised.
  it('drops non-primitive values and reports only their key names', () => {
    const out = sanitizeProperties({
      courseId: 'c1',
      sourceDocument: { text: 'Patient presented with...' },
      answers: ['a', 'b'],
    });
    expect(out).not.toHaveProperty('sourceDocument');
    expect(out).not.toHaveProperty('answers');
    expect(out.courseId).toBe('c1');
    expect(out.analytics_dropped_keys).toBe('sourceDocument,answers');
  });

  it('never lets nested content survive as a serialised string', () => {
    const out = sanitizeProperties({ payload: { phi: 'diagnosis: F41.1' } });
    expect(JSON.stringify(out)).not.toContain('F41.1');
  });
});

describe('sanitizeErrorText', () => {
  it('masks emails in an error message', () => {
    expect(sanitizeErrorText('failed to invite nurse@clinic.com')).toContain('***@clinic.com');
  });

  it('reduces a URL in a stack or message to its route shape', () => {
    expect(
      sanitizeErrorText(`GET https://app.theraptly.com/join/PkS8x2Lm9QvT4nR7wZ3b failed`),
    ).not.toContain('PkS8x2Lm9QvT4nR7wZ3b');
  });

  it('scrubs a bare path containing a record id', () => {
    expect(sanitizeErrorText(`no enrollment at /learn/${UUID}`)).toContain('/learn/[id]');
  });
});
