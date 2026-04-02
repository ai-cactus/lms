/**
 * Centralized structured logger.
 * - Outputs JSON in production (for log aggregators)
 * - Outputs readable format in development
 * - Never log raw PII — use maskEmail() before passing email fields
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogPayload {
  msg: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, payload: LogPayload): void {
  const entry = {
    level,
    time: new Date().toISOString(),
    env: process.env.NODE_ENV,
    ...payload,
  };

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
