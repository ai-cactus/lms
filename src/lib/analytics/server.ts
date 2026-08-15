import 'server-only';

/**
 * Server-side analytics.
 *
 * Used from server actions, route handlers, the AI pipeline and the BullMQ
 * workers. Client-side capture lives in client.ts; they share the event
 * allowlist and the sanitiser but not the transport.
 *
 * TWO THINGS THAT DIFFER FROM THE BROWSER, both of them load-bearing:
 *
 *   1. posthog-node has NO before_send hook — PostHogOptions omits it. The
 *      deny-by-default guard that instrumentation-client.ts installs therefore
 *      does not exist here, and this module has to enforce the allowlist and the
 *      sanitiser itself. Every capture path must go through captureServer().
 *
 *   2. This is a long-running Node server, not a serverless function, so events
 *      are batched rather than flushed per request. That makes shutdownAnalytics()
 *      mandatory: without it a deploy drops everything still in the queue.
 */
import { PostHog } from 'posthog-node';
import { logger } from '@/lib/logger';
import {
  isAllowedEvent,
  type AnalyticsEvent,
  type AnalyticsEventProperties,
} from '@/lib/analytics/events';
import { sanitizeProperties } from '@/lib/analytics/sanitize';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

/**
 * Singleton on globalThis, matching src/lib/prisma.ts and the BullMQ worker
 * getters. Next.js dev reloads modules on every edit; a module-scoped client
 * would leak a flush timer and an open connection per reload.
 */
const globalForPostHog = globalThis as unknown as { posthogServer?: PostHog | null };

/**
 * The raw client, for the exception path in errors.ts.
 *
 * Exposed rather than routed through captureServer() because captureException()
 * builds its own `$exception` payload — it is not a product event with a
 * declared property shape, so the typed allowlist does not apply to it.
 */
export function getServerClient(): PostHog | null {
  return getClient();
}

function getClient(): PostHog | null {
  if (!POSTHOG_KEY) return null;

  if (globalForPostHog.posthogServer === undefined) {
    globalForPostHog.posthogServer = new PostHog(POSTHOG_KEY, {
      host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
      // Batch rather than send-per-event: this process handles many requests and
      // an HTTP round trip per capture would put PostHog in the request path.
      flushAt: 20,
      flushInterval: 10_000,
      // Exception autocapture would ship raw error text — which on this app can
      // echo a Vertex prompt (source-document content) or a database value.
      // Errors are captured deliberately and redacted; see errors.ts.
      enableExceptionAutocapture: false,
    });
  }

  return globalForPostHog.posthogServer;
}

interface CaptureContext {
  /** The user id. Must match the browser's identify() or sessions split in two. */
  distinctId: string;
  /** Org id, sent as a GROUP so per-customer adoption and churn cohorts work. */
  organizationId?: string | null;
}

/**
 * Records a product event from the server.
 *
 * The generic ties `properties` to the event name, so an undeclared event or an
 * out-of-shape property is a compile error. The runtime allowlist check below is
 * not redundant with that: this is the only egress guard on the server side.
 *
 * Never throws and never awaits the network — a failure to record a funnel step
 * must not fail the user's actual operation.
 *
 * `properties` may be a THUNK, and should be whenever the values are derived
 * rather than literal (counts, `.some()` over a relation, date arithmetic). The
 * function body is safe, but arguments evaluated at the call site are ordinary
 * code in the action's hot path — a course must not fail to publish because a
 * query shape changed under its telemetry. Passing a thunk moves that
 * derivation inside this try/catch.
 */
export function captureServer<E extends AnalyticsEvent>(
  event: E,
  properties: AnalyticsEventProperties[E] | (() => AnalyticsEventProperties[E]),
  context: CaptureContext,
): void {
  const client = getClient();
  if (!client) return;

  try {
    if (!isAllowedEvent(event)) {
      logger.warn({ msg: '[analytics] Blocked unregistered server event', event });
      return;
    }

    const resolved = typeof properties === 'function' ? properties() : properties;

    client.capture({
      distinctId: context.distinctId,
      event,
      properties: sanitizeProperties(resolved as Record<string, unknown>),
      ...(context.organizationId ? { groups: { organization: context.organizationId } } : {}),
    });
  } catch (err) {
    logger.error({ msg: '[analytics] Server capture failed', err, event });
  }
}

/**
 * Sets properties on an organization group.
 *
 * Call on org creation and plan change, not per request — group properties are
 * overwritten wholesale, and a partial write would clear the others.
 *
 * A facility's business name and plan are commercial attributes, not PHI, and
 * without them every org in the PostHog UI is an opaque uuid.
 */
export function identifyOrganization(params: {
  organizationId: string;
  name?: string | null;
  plan?: string | null;
  seatCountBand?: string | null;
}): void {
  const client = getClient();
  if (!client) return;

  try {
    client.groupIdentify({
      groupType: 'organization',
      groupKey: params.organizationId,
      properties: sanitizeProperties({
        ...(params.name ? { name: params.name } : {}),
        ...(params.plan ? { plan: params.plan } : {}),
        ...(params.seatCountBand ? { seat_count_band: params.seatCountBand } : {}),
      }),
    });
  } catch (err) {
    logger.error({ msg: '[analytics] Group identify failed', err });
  }
}

/**
 * Flushes queued events and closes the client.
 *
 * Wired into the SIGTERM/SIGINT handler in src/instrumentation.ts, beside the
 * BullMQ worker close and the Prisma disconnect. Without this every deploy
 * silently discards up to flushInterval's worth of events, which looks exactly
 * like a drop in product usage.
 */
export async function shutdownAnalytics(): Promise<void> {
  // The flag client keeps a polling timer that would otherwise hold the event
  // loop open past shutdown. Imported lazily to keep flags off the capture
  // path's module graph.
  const { shutdownFlags } = await import('@/lib/analytics/flags');
  await shutdownFlags();

  const client = globalForPostHog.posthogServer;
  if (!client) return;

  try {
    // Bounded: a hanging flush must not block the shutdown sequence behind it.
    await client.shutdown(5_000);
  } catch (err) {
    logger.error({ msg: '[analytics] Shutdown flush failed', err });
  } finally {
    globalForPostHog.posthogServer = null;
  }
}
