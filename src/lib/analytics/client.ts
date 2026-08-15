'use client';

/**
 * Browser-side analytics API.
 *
 * The ONLY way client code should talk to PostHog. Every export here is inert
 * when analytics is disabled (no NEXT_PUBLIC_POSTHOG_KEY), and none of them
 * throw — a failure to record a funnel step must never surface to a user
 * mid-journey, so problems are logged and swallowed.
 *
 * Initialisation lives in instrumentation-client.ts, which also installs the
 * deny-by-default before_send guard that this module's output passes through.
 */
import posthog from 'posthog-js';
import { logger } from '@/lib/logger';
import type { AnalyticsEvent, AnalyticsEventProperties } from '@/lib/analytics/events';

/**
 * Mirrors the init guard. posthog-js queues calls made before init() and would
 * replay them if it were ever initialised later, so checking the key rather than
 * a "did init run" flag keeps a disabled build genuinely silent.
 */
function isEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

/**
 * Records a product event.
 *
 * The generic ties `properties` to the event name, so an undeclared event or a
 * property that is not in that event's shape is a compile error rather than a
 * runtime surprise (see events.ts).
 */
export function capture<E extends AnalyticsEvent>(
  event: E,
  properties: AnalyticsEventProperties[E],
): void {
  if (!isEnabled()) return;
  try {
    posthog.capture(event, properties);
  } catch (err) {
    logger.error({ msg: '[analytics] Client capture failed', err, event });
  }
}

/**
 * Binds the session to the person and their organization.
 *
 * Only the user id, their role, and the org are sent — never email or name,
 * which are the direct identifiers this project's no-BAA posture keeps out of
 * PostHog. The org is a GROUP, not a person property: group analytics is what
 * makes per-customer adoption and churn cohorts possible on a multi-tenant app.
 */
export function identify(params: {
  userId: string;
  role: string;
  organizationId: string | null;
  organizationName?: string | null;
}): void {
  if (!isEnabled()) return;
  try {
    posthog.identify(params.userId, { role: params.role });

    if (params.organizationId) {
      posthog.group('organization', params.organizationId, {
        // A facility's business name is not PHI, and without it every org in the
        // PostHog UI is an opaque uuid.
        ...(params.organizationName ? { name: params.organizationName } : {}),
      });
    }
  } catch (err) {
    logger.error({ msg: '[analytics] Client identify failed', err });
  }
}

/**
 * Clears the identity on logout.
 *
 * Required, not optional: without it the next person to use the same browser —
 * a real scenario on a shared workstation at a care facility — continues the
 * previous user's session and their events are attributed to the wrong person.
 */
export function resetIdentity(): void {
  if (!isEnabled()) return;
  try {
    posthog.reset();
  } catch (err) {
    logger.error({ msg: '[analytics] Client reset failed', err });
  }
}
