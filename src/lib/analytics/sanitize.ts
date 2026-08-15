/**
 * Outbound sanitisation for analytics.
 *
 * PostHog is a third party on a no-PHI contract (no BAA), so nothing leaves this
 * module that could carry protected health information, a credential, or a
 * direct identifier. Two concerns live here:
 *
 *   PATHS  — route paths embed record IDs and, at /join/:token, an invite token
 *            that IS a credential. Raw `$current_url` would ship it to PostHog.
 *            normalizePath() reduces a path to its ROUTE SHAPE (/join/[token]),
 *            which is what funnels actually need.
 *
 *   VALUES — property objects are scrubbed by the SAME redactor the structured
 *            logger uses (redactLogPayload from @/lib/logger). One PII policy,
 *            two consumers: a rule added for logs protects analytics for free,
 *            and the two cannot drift.
 *
 * This module is runtime-agnostic on purpose — it is imported by the browser
 * bundle and the Node server alike, so it must not touch node: builtins.
 */
import { redactLogPayload, maskEmailsInText } from '@/lib/logger';

/** Stand-ins that keep a path groupable while carrying no data. */
const ID_PLACEHOLDER = '[id]';
const TOKEN_PLACEHOLDER = '[token]';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_PATTERN = /^\d+$/;

/**
 * High-entropy opaque strings — invite tokens, verification tokens, signed refs.
 *
 * Length alone is not enough to tell a token from a route name: this app has
 * segments like `verify-certificate` and `select-organization` that are longer
 * than a short token, and scrubbing them would collapse unrelated pages into one
 * meaningless funnel step. ROUTE_NAME_PATTERN is the discriminator — a segment
 * that is plain lowercase kebab-case is a route name, because the token sources
 * in use (crypto random hex / base64url) essentially always carry a digit or an
 * uppercase character.
 *
 * This heuristic is only the backstop for routes nobody anticipated. The routes
 * whose dynamic segment is KNOWN to be sensitive do not depend on it at all —
 * see ALWAYS_SCRUB_AFTER below.
 */
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,}$/;
const ROUTE_NAME_PATTERN = /^[a-z]+(?:-[a-z]+)*$/;

/**
 * Route prefixes whose NEXT segment is always scrubbed, whatever it looks like.
 *
 * Shape detection above is a heuristic and a short or unusually-formatted token
 * could slip past it. For the routes where the dynamic segment is known to be
 * sensitive, we do not rely on the heuristic at all — /join carries the invite
 * credential, and the rest carry record IDs that identify a learner's training.
 */
const ALWAYS_SCRUB_AFTER: Record<string, string> = {
  join: TOKEN_PLACEHOLDER,
  learn: ID_PLACEHOLDER,
  'verify-certificate': ID_PLACEHOLDER,
};

function scrubSegment(segment: string): string {
  if (UUID_PATTERN.test(segment)) return ID_PLACEHOLDER;
  if (NUMERIC_PATTERN.test(segment)) return ID_PLACEHOLDER;
  if (ROUTE_NAME_PATTERN.test(segment)) return segment;
  if (OPAQUE_TOKEN_PATTERN.test(segment)) return TOKEN_PLACEHOLDER;
  return segment;
}

/**
 * Reduces a URL path to its route shape.
 *
 * Accepts a pathname or a full URL. Any query string and fragment are dropped
 * WHOLESALE rather than filtered — an allowlist would have to be maintained in
 * step with every new link in the app, and the first missed parameter is a leak.
 *
 * @example
 * normalizePath('/join/aG9sZGVyVG9rZW5=')            // → '/join/[token]'
 * normalizePath('/learn/3f2b...-...')                // → '/learn/[id]'
 * normalizePath('/dashboard/courses/<uuid>/edit')    // → '/dashboard/courses/[id]/edit'
 * normalizePath('/dashboard?email=a@b.com')          // → '/dashboard'
 */
export function normalizePath(input: string): string {
  if (!input) return '/';

  // Tolerate a full URL without needing a base: keep everything before ? or #.
  let pathname = input.split('?')[0].split('#')[0];

  const schemeIndex = pathname.indexOf('://');
  if (schemeIndex !== -1) {
    const afterHost = pathname.indexOf('/', schemeIndex + 3);
    pathname = afterHost === -1 ? '/' : pathname.slice(afterHost);
  }

  const segments = pathname.split('/');
  const normalized = segments.map((segment, index) => {
    if (!segment) return segment;

    const parent = index > 0 ? segments[index - 1] : '';
    const forced = ALWAYS_SCRUB_AFTER[parent];
    if (forced) return forced;

    return scrubSegment(segment);
  });

  const result = normalized.join('/');
  return result === '' ? '/' : result;
}

/**
 * Property values are restricted to primitives.
 *
 * An object or array is a channel for free text, and free text on this app means
 * course content generated from clinical source documents. Rejecting non-scalars
 * outright is cruder than scrubbing them, but it is checkable — a reviewer can
 * confirm the rule holds by reading one function.
 */
function isAllowedValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Scrubs one analytics property bag.
 *
 * Non-primitive values are dropped and their KEYS reported under
 * `analytics_dropped_keys`, mirroring the logger's errExtraKeysOmitted: a
 * developer can still see that something was discarded without the value being
 * disclosed. Surviving values then pass through the logger's redactor, so
 * sensitive key names are blanked and email-shaped text is masked.
 */
export function sanitizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const allowed: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(properties)) {
    if (isAllowedValue(value)) {
      allowed[key] = value;
    } else {
      dropped.push(key);
    }
  }

  const redacted = redactLogPayload(allowed);
  if (dropped.length > 0) {
    redacted.analytics_dropped_keys = dropped.join(',');
  }

  return redacted;
}

/**
 * Scrubs an exception message or stack before it reaches error tracking.
 *
 * Error text is the least controlled string in the system: a Vertex AI failure
 * echoes the prompt (source-document text), and a database error echoes column
 * values. Emails are masked and any URL-ish substring is reduced to its route
 * shape so a token in a failing request URL cannot ride along.
 */
export function sanitizeErrorText(text: string): string {
  const withPathsNormalized = text.replace(
    /(?:https?:\/\/[^\s"')]+|\/[A-Za-z0-9._~\-/[\]]+)/g,
    (match) => normalizePath(match),
  );
  return maskEmailsInText(withPathsNormalized);
}
