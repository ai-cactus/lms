import 'server-only';

/**
 * Server exception capture.
 *
 * Separate from errors.ts by RUNTIME, not by preference — see the note there.
 * The `server-only` import above is what keeps posthog-node out of the browser
 * bundle, and it is load-bearing: an earlier single-file version failed the
 * build for exactly this reason.
 *
 * Called EXPLICITLY beside an existing logger.error, never wired into the logger
 * itself. The logger records expected, handled failures too — a bounced email, a
 * rate-limited caller — and routing all of those into error tracking would bury
 * the real incidents.
 */
import { logger } from '@/lib/logger';
import { sanitizeErrorText } from '@/lib/analytics/sanitize';
import { getServerClient } from '@/lib/analytics/server';

const MAX_STACK_CHARS = 4_000;

/**
 * Reduces an unknown throw to the scalars worth sending, all sanitised.
 *
 * Arbitrary own-properties on an Error are DROPPED, mirroring the allowlist the
 * logger applies in serializeError: an error carrying a request body or a token
 * is exactly how that leaked before (F-078).
 */
function describeError(err: unknown): { name: string; message: string; stack: string | null } {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: sanitizeErrorText(err.message),
      // React stacks run to hundreds of frames; the tail is framework internals
      // that cost payload without aiding diagnosis.
      stack: err.stack ? sanitizeErrorText(err.stack).slice(0, MAX_STACK_CHARS) : null,
    };
  }

  return { name: 'NonError', message: sanitizeErrorText(String(err)), stack: null };
}

export function captureServerException(
  err: unknown,
  context: { area: string; distinctId?: string | null; organizationId?: string | null },
): void {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;

  try {
    const client = getServerClient();
    if (!client) return;

    // Unlike the browser, posthog-node has NO before_send hook, so nothing can
    // scrub what the SDK derives from the error. A pre-sanitised stand-in is
    // passed instead: same shape, but message and stack have already been
    // through sanitizeErrorText, so the exception_list is safe by construction.
    const described = describeError(err);
    const safeError = new Error(described.message);
    safeError.name = described.name;
    safeError.stack = described.stack ?? undefined;

    client.captureException(
      safeError,
      // Unattributed server errors (jobs, sweeps) still matter, so a synthetic
      // id is used rather than dropping the event. Unlike a product event, this
      // cannot distort a funnel or inflate a unique-user count.
      context.distinctId ?? 'system',
      {
        area: context.area,
        ...(context.organizationId ? { $groups: { organization: context.organizationId } } : {}),
      },
    );
  } catch (captureErr) {
    logger.error({ msg: '[analytics] Server exception capture failed', err: captureErr });
  }
}
