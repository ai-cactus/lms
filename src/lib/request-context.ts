/**
 * Per-request context propagated via AsyncLocalStorage.
 *
 * Carries a correlation ID so every structured log emitted while handling a
 * single request can be tied together without threading the ID through every
 * function signature. The logger (src/lib/logger.ts) reads getCorrelationId()
 * on the emit path, so wrapping a request in runWithCorrelationId() is enough
 * to stamp all downstream logs.
 *
 * The store is request-scoped: outside an active runWithCorrelationId() call,
 * getCorrelationId() returns undefined and the logger simply omits the field.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with the given correlation ID bound to the async context, so any
 * logs emitted (directly or transitively) during `fn` include the ID.
 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/**
 * Returns the correlation ID for the current async context, or undefined when
 * called outside of a runWithCorrelationId() scope.
 */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
