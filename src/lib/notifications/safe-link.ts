import { logger } from '@/lib/logger';

/**
 * A fixed, never-resolvable origin used only as the parse base. Resolving
 * against a constant (rather than `window.location.origin`) keeps the check
 * identical on the server and the client: anything that resolves to a
 * different origin was an absolute or protocol-relative URL.
 */
const PARSE_BASE_ORIGIN = 'http://notification-link.invalid';

/**
 * Backslashes (browsers normalise `\` to `/`, turning `/\evil.com` into the
 * protocol-relative `//evil.com`), ASCII control characters, and whitespace
 * (the URL parser strips leading/trailing C0+space and every tab/newline, so
 * `"/\t/evil.com"` collapses to `//evil.com`). No legitimate app path contains
 * any of them unencoded.
 */
const UNSAFE_CHARACTERS = /[\\\u0000-\u001F\u007F\s]/;

/**
 * Returns `link` as a same-origin, app-relative path (`/path?query#hash`), or
 * `null` when it is anything else — an absolute or protocol-relative URL, a
 * `javascript:`/`data:` or other scheme, a relative-without-slash path, or a
 * string carrying characters browsers strip or rewrite before parsing.
 *
 * Notification links are stored data; they must never be allowed to navigate
 * off-site from inside the trusted UI, whatever wrote them.
 */
export function toSafeAppPath(link: string | null | undefined): string | null {
  if (typeof link !== 'string' || link.length === 0) return null;
  if (!link.startsWith('/') || link.startsWith('//')) return null;
  if (UNSAFE_CHARACTERS.test(link)) return null;

  let resolved: URL;
  try {
    resolved = new URL(link, PARSE_BASE_ORIGIN);
  } catch {
    return null;
  }
  if (resolved.origin !== PARSE_BASE_ORIGIN) return null;

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/**
 * {@link toSafeAppPath} for a notification about to be followed. Logs when a
 * stored link is suppressed so bad rows are traceable by id — the URL itself is
 * deliberately left out, since it may carry tokens.
 */
export function resolveNotificationLink(
  notificationId: string,
  linkUrl: string | null | undefined,
): string | null {
  const safe = toSafeAppPath(linkUrl);
  if (safe === null && linkUrl) {
    logger.warn({ msg: '[notifications] Suppressed unsafe notification link', notificationId });
  }
  return safe;
}
