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

interface LogPayload {
  msg: string;
  err?: unknown;
  [key: string]: unknown;
}

/**
 * Safely serialize an unknown error value into plain JSON-compatible fields.
 * Error instances have non-enumerable properties so JSON.stringify drops them.
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      errName: err.name,
      errMessage: err.message,
      errStack: err.stack,
      // Capture any extra own properties (e.g. S3Error.code, .bucketname)
      ...Object.fromEntries(
        Object.getOwnPropertyNames(err)
          .filter((k) => !['name', 'message', 'stack'].includes(k))
          .map((k) => [`err_${k}`, (err as unknown as Record<string, unknown>)[k]]),
      ),
    };
  }
  if (typeof err === 'object' && err !== null) {
    return { errRaw: JSON.stringify(err) };
  }
  return { errRaw: String(err) };
}

function emit(level: LogLevel, payload: LogPayload): void {
  const { err, ...rest } = payload;

  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    env: process.env.NODE_ENV,
    ...rest,
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
