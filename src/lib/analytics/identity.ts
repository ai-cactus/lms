import 'server-only';

/**
 * Turns a resolved session into the identity captureServer() needs.
 *
 * Deliberately a PURE MAPPER rather than something that calls auth() itself:
 * every server action already resolves a session before doing anything, so
 * re-resolving here would double the work and, on the dual-context actions that
 * race adminAuth() against workerAuth(), could disagree with the session the
 * action actually acted on.
 *
 * `distinctId` is the USER id, matching what the browser sends via
 * posthog.identify(). If these two ever diverge, one person becomes two in every
 * funnel and the client/server halves of a journey stop joining up.
 */

/** Structural, so both the admin and worker session shapes satisfy it. */
interface SessionLike {
  user?: {
    id?: string | null;
    organizationId?: string | null;
  } | null;
}

export interface AnalyticsContext {
  distinctId: string;
  organizationId?: string | null;
}

/**
 * Returns null when there is no usable identity — an unauthenticated caller, or
 * a session mid-construction. Callers skip capture rather than inventing an id:
 * a synthetic distinctId would create a junk person profile per request and
 * quietly inflate every unique-user count.
 */
export function analyticsContextFrom(
  session: SessionLike | null | undefined,
): AnalyticsContext | null {
  const userId = session?.user?.id;
  if (!userId) return null;

  return {
    distinctId: userId,
    organizationId: session?.user?.organizationId ?? null,
  };
}
