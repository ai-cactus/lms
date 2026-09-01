'use client';

/**
 * Browser exception capture.
 *
 * The server counterpart lives in errors.server.ts and is deliberately a
 * SEPARATE module. They were one file until the build rejected it: this module
 * is imported by RouteErrorBoundary ('use client'), and even a dynamic
 * `import('./server')` inside it is traced by the bundler into the client graph,
 * which then trips the `server-only` guard on the posthog-node client. Splitting
 * by runtime is the fix — importing a server module from here must stay
 * impossible, not merely discouraged.
 *
 * ⚠️  Error text is the least controlled string in this system. A Vertex failure
 * echoes the prompt (a facility's uploaded document); a Prisma failure echoes
 * column values; a fetch failure echoes the URL, which at /join/:token is a
 * credential. Redaction for this path happens in the `before_send` hook in
 * instrumentation-client.ts, which deep-walks the `$exception` payload and
 * scrubs every string while preserving the structure error tracking needs.
 *
 * PostHog's own exception autocapture is disabled (`capture_exceptions: false`)
 * precisely so that hook is the only way an exception can be produced.
 */
import posthog from 'posthog-js';
import { logger } from '@/lib/logger';

/**
 * Captures a browser exception.
 *
 * `digest` is Next.js's server-error correlator: when a Server Component throws
 * in production the client receives only an opaque digest, and it is the sole
 * link between what the user saw and the real stack in the server logs.
 */
export function captureClientException(
  err: unknown,
  context: { area: string; digest?: string },
): void {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;

  try {
    // The REAL error is passed so PostHog can parse frames into a proper
    // `$exception_list`. Scrubbing happens on egress, not here.
    posthog.captureException(err, {
      area: context.area,
      digest: context.digest ?? null,
    });
  } catch (captureErr) {
    // Reporting an error must never itself throw inside an error boundary —
    // that turns a handled failure into an unrecoverable one.
    logger.error({ msg: '[analytics] Client exception capture failed', err: captureErr });
  }
}
