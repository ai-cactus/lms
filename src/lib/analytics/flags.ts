import 'server-only';

/**
 * Server-evaluated feature flags.
 *
 * ⛔ WHAT THIS IS NOT FOR: infrastructure kill-switches. `VIDEO_SWEEP_ENABLED`,
 * `REMINDER_SWEEP_ENABLED` and `NOTIFICATION_DIGEST_ENABLED` stay environment
 * variables and must not migrate here. They are read at boot in
 * src/instrumentation.ts and have to work when PostHog is unreachable — a
 * kill-switch that depends on a third party being up is not a kill-switch.
 *
 * This is for PRODUCT rollouts: gradual releases, and experiments where PostHog
 * needs to attribute a conversion to a variant.
 *
 * EVERY FLAG DECLARES A LOCAL DEFAULT. PostHog sits on the network, and a
 * network call in a render path has two bad outcomes — an exception, or a hang.
 * Both are answered the same way here: log it and return the value the app
 * behaves correctly with. A flag lookup can degrade; a page cannot.
 */
import { PostHog } from 'posthog-node';
import { logger } from '@/lib/logger';

/**
 * The flag registry. A key not listed here cannot be requested, so a typo is a
 * compile error rather than a silently-false flag — which is the failure mode
 * that makes flag bugs hard to spot, because "off" looks like a deliberate
 * rollout state.
 *
 * The value is what the app does when PostHog cannot be reached. Choose the
 * CURRENT production behaviour, not the behaviour you are rolling towards:
 * an outage should look like "the new thing hasn't reached me yet", never like
 * an unreviewed feature switching itself on for everyone.
 */
export const FLAG_DEFAULTS = {
  'onboarding-step3-variant': false,
  'document-hub-redesign': false,
  'video-course-catalog': false,
} as const;

export type FeatureFlagKey = keyof typeof FLAG_DEFAULTS;

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

/**
 * Separate client from the capture one in server.ts.
 *
 * Flag evaluation wants `secretKey` (local evaluation, no per-call HTTP) and a
 * polling interval; capture wants neither. Sharing one client would force the
 * capture path to carry a flag-polling timer it never uses.
 */
const globalForFlags = globalThis as unknown as { posthogFlags?: PostHog | null };

function getFlagClient(): PostHog | null {
  if (!POSTHOG_KEY) return null;

  if (globalForFlags.posthogFlags === undefined) {
    globalForFlags.posthogFlags = new PostHog(POSTHOG_KEY, {
      host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
      // Present only when local evaluation is configured. Without it each
      // lookup is a network round trip, which the timeout below bounds.
      ...(process.env.POSTHOG_SECRET_KEY ? { secretKey: process.env.POSTHOG_SECRET_KEY } : {}),
      featureFlagsPollingInterval: 60_000,
    });
  }

  return globalForFlags.posthogFlags;
}

/** Beyond this, the default is better than making the user wait. */
const FLAG_TIMEOUT_MS = 1_500;

export interface FlagContext {
  distinctId: string;
  organizationId?: string | null;
}

/**
 * Resolves one flag, falling back to its declared default on ANY failure —
 * error, timeout, or analytics being disabled entirely.
 *
 * The organization is passed as a group so a flag can be rolled out per
 * customer, which on a multi-tenant B2B app is usually the unit that matters:
 * a facility should not see half its staff on a new flow.
 */
export async function getFeatureFlag(key: FeatureFlagKey, context: FlagContext): Promise<boolean> {
  const fallback = FLAG_DEFAULTS[key];
  const client = getFlagClient();
  if (!client) return fallback;

  try {
    const result = await Promise.race([
      client.getFeatureFlag(key, context.distinctId, {
        ...(context.organizationId ? { groups: { organization: context.organizationId } } : {}),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('flag evaluation timed out')), FLAG_TIMEOUT_MS),
      ),
    ]);

    // PostHog returns a string for MULTIVARIATE flags and undefined when the
    // flag does not exist. Neither is a boolean the caller can branch on, so
    // both fall back rather than being coerced into an accidental `true`.
    if (typeof result === 'boolean') return result;
    if (result === undefined) return fallback;

    logger.warn({ msg: '[flags] Non-boolean flag requested as boolean', flag: key });
    return fallback;
  } catch (err) {
    logger.error({ msg: '[flags] Evaluation failed, using default', err, flag: key, fallback });
    return fallback;
  }
}

/**
 * Resolves every flag at once, for bootstrapping the browser.
 *
 * Passing these into posthog-js's `bootstrap` option means the first client
 * render already knows every value, so a gated feature does not flash its
 * default and then swap — which reads as a bug and, mid-experiment, pollutes
 * the variant exposure data.
 */
export async function getAllFlags(context: FlagContext): Promise<Record<FeatureFlagKey, boolean>> {
  const keys = Object.keys(FLAG_DEFAULTS) as FeatureFlagKey[];
  const values = await Promise.all(keys.map((key) => getFeatureFlag(key, context)));

  return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<
    FeatureFlagKey,
    boolean
  >;
}

/** Closes the flag client's polling timer. Called from shutdownAnalytics(). */
export async function shutdownFlags(): Promise<void> {
  const client = globalForFlags.posthogFlags;
  if (!client) return;

  try {
    await client.shutdown(2_000);
  } catch (err) {
    logger.error({ msg: '[flags] Shutdown failed', err });
  } finally {
    globalForFlags.posthogFlags = null;
  }
}
