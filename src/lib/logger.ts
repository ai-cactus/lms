/**
 * Centralized structured logger.
 * - Outputs JSON in production (for log aggregators)
 * - Outputs readable format in development
 * - Never log raw PII — use maskEmail() before passing email fields
 *
 * Error serialisation:
 *   Pass errors under the key `err`. The logger will expand them to
 *   { errName, errMessage, errStack } so JSON.stringify doesn't lose them.
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * Correlation-ID provider, registered at runtime by the Node-only request
 * context module (src/lib/request-context.ts) via setCorrelationIdProvider().
 *
 * The logger must stay usable in the browser and the Edge middleware runtime,
 * neither of which can load `node:async_hooks`. Statically importing the
 * request-context module here would pull that Node builtin into client/edge
 * bundles and break the build, so we keep the logger dependency-free and let
 * the server register a provider only where AsyncLocalStorage is available.
 */
let correlationIdProvider: (() => string | undefined) | null = null;

export function setCorrelationIdProvider(provider: () => string | undefined): void {
  correlationIdProvider = provider;
}

interface LogPayload {
  msg: string;
  err?: unknown;
  [key: string]: unknown;
}

/* ─── Redaction (F-078) ─────────────────────────────────────────────────────
 *
 * PII safety used to depend on every developer remembering to call maskEmail
 * before passing an address into a log field. That is a code-review habit, not
 * a control, and it fails silently. Redaction is now structural: the logger
 * scrubs payloads on the way out, so forgetting is no longer possible.
 *
 * Two matching strategies, and the split is deliberate:
 *
 *   FRAGMENT — matched anywhere in the key. Reserved for words that are never
 *   part of an innocuous field name ('password', 'secret', 'token', …). Safe to
 *   be greedy with.
 *
 *   EXACT — matched only as the whole key. Used for broad words that DO appear
 *   inside safe field names: redacting on the fragment 'content' would also
 *   scrub `contentHash` and `contentLength`, which the PHI decision ledger logs
 *   on purpose. `content` alone is the document text; `contentHash` is a digest.
 *
 * Values are also swept for anything shaped like an email address, including in
 * `msg`, because addresses interpolated into a message string were the most
 * common leak and no key-based rule can catch them.
 */

const REDACTED = '[REDACTED]';

/** Never part of a harmless field name — safe to match as a substring. */
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'credential',
  'privatekey',
  'accesskey',
  'bearer',
  'sessionid',
];

/** Broad words that appear inside safe field names — whole-key match only. */
const SENSITIVE_KEYS_EXACT = new Set([
  'content',
  'contents',
  'snippet',
  'answers',
  'answer',
  'address',
  'phone',
  'dob',
  'dateofbirth',
  'ssn',
  'signature',
  'attestationsignature',
  'body',
]);

/** Routed through maskEmail rather than blanked, since the domain is useful. */
const EMAIL_KEY_FRAGMENTS = ['email', 'recipient', 'mailto'];

// Deliberately loose: this is a redaction heuristic, not a validator. Over-
// matching costs a mangled log line; under-matching leaks an address.
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Depth cap: bounds work on deep structures and, with `seen`, stops cycles. */
const MAX_REDACT_DEPTH = 6;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const k = normalizeKey(key);
  if (SENSITIVE_KEYS_EXACT.has(k)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => k.includes(fragment));
}

function isEmailKey(key: string): boolean {
  const k = normalizeKey(key);
  return EMAIL_KEY_FRAGMENTS.some((fragment) => k.includes(fragment));
}

/** Masks any email-shaped substring inside a free-text value. */
function maskEmailsInText(value: string): string {
  return value.replace(EMAIL_PATTERN, (match) => maskEmail(match));
}

function redactValue(key: string, value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (isSensitiveKey(key)) return REDACTED;

  if (typeof value === 'string') {
    return isEmailKey(key) ? maskEmail(value) : maskEmailsInText(value);
  }

  if (value === null || typeof value !== 'object') return value;

  if (depth >= MAX_REDACT_DEPTH) return '[TRUNCATED]';

  // Cycles would otherwise recurse forever; a logger must never be the thing
  // that takes the process down.
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(key, entry, depth + 1, seen));
  }

  return redactObject(value as Record<string, unknown>, depth + 1, seen);
}

function redactObject(
  input: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = redactValue(key, value, depth, seen);
  }
  return output;
}

/** Entry point: scrubs one log payload. */
export function redactLogPayload(input: Record<string, unknown>): Record<string, unknown> {
  return redactObject(input, 0, new WeakSet());
}

/**
 * Extra own-properties worth keeping off an Error. Everything else is dropped.
 *
 * This used to spread ALL own properties as `err_*`, so an error carrying a
 * token, a request body, or a raw email leaked it straight into the log line
 * (F-078). An allow-list inverts the default: unknown properties are omitted,
 * and their NAMES are reported so a developer can still tell something was
 * there without the value being disclosed.
 */
const ERROR_PROP_ALLOWLIST = new Set([
  'code',
  'errno',
  'syscall',
  'status',
  'statusCode',
  'statusText',
  'type',
  'reason',
  'resource',
  'bucketname',
  'requestId',
  'path',
]);

const ERROR_BASE_PROPS = ['name', 'message', 'stack'];

/**
 * Safely serialize an unknown error value into plain JSON-compatible fields.
 * Error instances have non-enumerable properties so JSON.stringify drops them.
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const source = err as unknown as Record<string, unknown>;
    const extras: Record<string, unknown> = {};
    const omitted: string[] = [];

    for (const key of Object.getOwnPropertyNames(err)) {
      if (ERROR_BASE_PROPS.includes(key)) continue;
      if (ERROR_PROP_ALLOWLIST.has(key)) {
        extras[`err_${key}`] = redactValue(key, source[key], 0, new WeakSet());
      } else {
        omitted.push(key);
      }
    }

    return {
      errName: err.name,
      // The message is free text and routinely interpolates an identifier.
      errMessage: maskEmailsInText(err.message),
      errStack: err.stack ? maskEmailsInText(err.stack) : err.stack,
      ...extras,
      ...(omitted.length ? { errExtraKeysOmitted: omitted } : {}),
    };
  }
  if (typeof err === 'object' && err !== null) {
    return { errRaw: JSON.stringify(redactLogPayload(err as Record<string, unknown>)) };
  }
  return { errRaw: maskEmailsInText(String(err)) };
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function emit(level: LogLevel, payload: LogPayload): void {
  const configuredLevel = (process.env.LOG_LEVEL?.toLowerCase() || 'info') as LogLevel;
  const configuredScore = LOG_LEVELS[configuredLevel] ?? LOG_LEVELS.info;
  const messageScore = LOG_LEVELS[level] ?? 0;

  if (messageScore < configuredScore) {
    return;
  }

  const { err, ...rest } = payload;

  // Correlation ID is request/job-scoped, resolved through the provider the
  // Node server registers (undefined in the browser/edge or outside a scope).
  const correlationId = correlationIdProvider?.();

  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    env: process.env.NODE_ENV,
    ...(correlationId ? { correlationId } : {}),
    // F-078: scrub before the entry is assembled. Structural rather than
    // per-call-site, so a forgotten maskEmail can no longer leak.
    ...redactLogPayload(rest),
  };

  // Expand Error objects so JSON.stringify captures message + stack
  if (err !== undefined) {
    Object.assign(entry, serializeError(err));
  }

  if (process.env.NODE_ENV === 'production') {
    // Structured JSON for log aggregators (Datadog, CloudWatch, etc.)
    const consoleFn = level === 'debug' ? console.log : console[level];
    consoleFn(JSON.stringify(entry));
  } else {
    // Human-readable for local development
    const consoleFn = level === 'debug' ? console.log : console[level];
    consoleFn(`[${level.toUpperCase()}] ${payload.msg}`, entry);
  }
}

export const logger = {
  info: (payload: LogPayload) => emit('info', payload),
  warn: (payload: LogPayload) => emit('warn', payload),
  error: (payload: LogPayload) => emit('error', payload),
  debug: (payload: LogPayload) => emit('debug', payload),
};

/**
 * Masks an email address for safe structured logging.
 * Prevents PII exposure in log aggregators and log pipelines.
 *
 * @example
 * maskEmail('admin@company.com') // → 'ad***@company.com'
 * maskEmail('a@x.com')          // → '***@x.com'
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex < 0) return '***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (local.length <= 2) return `***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}
