import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  logger: { warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveNotificationLink, toSafeAppPath } from './safe-link';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toSafeAppPath — rejects every off-site or scheme-bearing link', () => {
  it.each([
    ['absolute https', 'https://evil.com/phish'],
    ['absolute http', 'http://evil.com'],
    ['scheme with no slashes', 'https:evil.com'],
    ['protocol-relative', '//evil.com'],
    ['protocol-relative with path', '//evil.com/dashboard'],
    ['slash-backslash', '/\\evil.com'],
    ['double backslash', '\\\\evil.com'],
    ['backslash-slash', '\\/evil.com'],
    ['single backslash', '\\evil.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['javascript scheme, mixed case', 'JavaScript:alert(1)'],
    ['javascript scheme with a comment tail', 'javascript:alert(1)//x'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript scheme', 'vbscript:msgbox(1)'],
    ['mailto scheme', 'mailto:someone@example.com'],
    ['leading spaces before protocol-relative', '  //evil.com'],
    ['leading space before a valid path', ' /dashboard'],
    ['trailing space', '/dashboard '],
    ['tab splitting the double slash', '/\t/evil.com'],
    ['newline splitting the double slash', '/\n/evil.com'],
    ['carriage return splitting the double slash', '/\r/evil.com'],
    ['leading NUL', '\u0000//evil.com'],
    ['leading C0 control', '\u001F/dashboard'],
    ['DEL character', '/dash\u007Fboard'],
    ['non-breaking space', `/${String.fromCharCode(0xa0)}/evil.com`],
    ['BOM prefix', `${String.fromCharCode(0xfeff)}//evil.com`],
    ['relative without leading slash', 'dashboard/staff'],
    ['dot-relative', './dashboard'],
    ['query-only', '?next=https://evil.com'],
    ['hash-only', '#section'],
    ['empty string', ''],
  ])('rejects %s', (_label, link) => {
    expect(toSafeAppPath(link)).toBeNull();
  });

  it.each([null, undefined])('rejects %s', (link) => {
    expect(toSafeAppPath(link)).toBeNull();
  });
});

describe('toSafeAppPath — keeps legitimate app paths', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/worker/trainings', '/worker/trainings'],
    ['/dashboard/staff/cm1abc2def3', '/dashboard/staff/cm1abc2def3'],
    ['/learn/course-123', '/learn/course-123'],
    ['/dashboard/documents?tab=recent', '/dashboard/documents?tab=recent'],
    ['/dashboard/staff/abc?tab=courses&page=2', '/dashboard/staff/abc?tab=courses&page=2'],
    ['/learn/course-123#module-4', '/learn/course-123#module-4'],
    [
      '/dashboard/status-tracker?filter=overdue#top',
      '/dashboard/status-tracker?filter=overdue#top',
    ],
    ['/dashboard?redirect=https%3A%2F%2Fevil.com', '/dashboard?redirect=https%3A%2F%2Fevil.com'],
    ['/search?q=hello%20world', '/search?q=hello%20world'],
    ['/', '/'],
  ])('keeps %s', (link, expected) => {
    expect(toSafeAppPath(link)).toBe(expected);
  });

  it('normalises dot segments without leaving the origin', () => {
    expect(toSafeAppPath('/dashboard/../worker/trainings')).toBe('/worker/trainings');
    expect(toSafeAppPath('/../../evil.com')).toBe('/evil.com');
  });
});

describe('resolveNotificationLink', () => {
  it('returns the safe path without logging', () => {
    expect(resolveNotificationLink('notif-1', '/worker/trainings')).toBe('/worker/trainings');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('suppresses an unsafe link and warns with the id but never the URL', () => {
    const link = 'https://evil.com/reset?token=secret-token';
    expect(resolveNotificationLink('notif-2', link)).toBeNull();
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const payload = mockWarn.mock.calls[0][0];
    expect(payload).toMatchObject({ notificationId: 'notif-2' });
    expect(JSON.stringify(payload)).not.toContain('evil.com');
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  });

  it('does not warn when there is no link at all', () => {
    expect(resolveNotificationLink('notif-3', null)).toBeNull();
    expect(resolveNotificationLink('notif-4', undefined)).toBeNull();
    expect(resolveNotificationLink('notif-5', '')).toBeNull();
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
