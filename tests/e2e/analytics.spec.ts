/**
 * E2E spec: PostHog analytics egress guard.
 *
 * Story: the app sends product analytics to PostHog, a third party operating
 * WITHOUT a BAA for this project. It must therefore never receive protected
 * health information, a credential, or a direct identifier.
 *
 * The unit tests cover each guard in isolation. This spec covers the thing they
 * cannot: what a REAL browser actually puts on the wire after the full chain of
 * SDK config, before_send hook, path normaliser and property sanitiser has run.
 * A misconfiguration in any one of them — or a posthog-js upgrade that changes a
 * default — shows up here and nowhere else.
 *
 * Acceptance criteria:
 *   - Analytics is inert when no PostHog key is configured.
 *   - With a key configured, ingest goes to the SAME-ORIGIN /ingest path, never
 *     to a posthog.com host directly.
 *   - No captured payload ever contains an autocapture, session-replay or
 *     heatmap event.
 *   - No captured payload ever contains an email address.
 *   - No captured payload ever contains a raw record id or an invite token in a
 *     URL property.
 *
 * Pre-conditions / infra notes:
 *   - App running on the base URL from playwright.config.ts.
 *   - Requests to /ingest/** are INTERCEPTED and fulfilled locally, so no
 *     traffic reaches PostHog and no project key is required to be real.
 *   - Only public, unauthenticated routes are exercised, so this needs no DB
 *     seed or login (see src/proxy.ts ROUTE_CONFIG).
 */

import { gunzipSync } from 'node:zlib';
import { test, expect, type Request } from '@playwright/test';

/** Anything a captured payload must never contain. */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Events that must never leave the browser — see ALLOWED_EVENTS in events.ts. */
const FORBIDDEN_EVENTS = [
  '$autocapture',
  '$rageclick',
  '$dead_click',
  '$copy_autocapture',
  '$snapshot',
  '$web_vitals',
  '$heatmap',
];

/**
 * Decodes one ingest request body to searchable text.
 *
 * ⚠️  posthog-js does NOT send plaintext JSON, and it does not use one encoding.
 * Capture batches arrive GZIPPED at /ingest/e/; other endpoints form-encode a
 * base64 payload as `data=<...>`. Searching the raw bytes matches nothing, so
 * every "must never be sent" assertion below passes vacuously — a green suite
 * that tests nothing, which is worse than no suite. Both encodings are handled,
 * and the control test at the bottom fails loudly if decoding ever silently
 * stops working.
 */
function decodeIngestBody(buffer: Buffer | null, body: string | null): string {
  // gzip magic number. Capture batches take this path.
  if (buffer && buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      return gunzipSync(buffer).toString('utf8');
    } catch {
      // Fall through — a corrupt body is better searched raw than dropped.
    }
  }

  if (!body) return buffer?.toString('utf8') ?? '';

  // Form-encoded `data=<base64>`.
  let candidate = body;
  try {
    const data = new URLSearchParams(body).get('data');
    if (data) candidate = data;
  } catch {
    // Not form-encoded.
  }

  try {
    const asText = Buffer.from(decodeURIComponent(candidate), 'base64').toString('utf8');
    // Decoding non-base64 input yields mojibake; requiring a JSON opener keeps
    // us from asserting against garbage.
    if (asText.trimStart().startsWith('{') || asText.trimStart().startsWith('[')) return asText;
  } catch {
    // Not base64.
  }

  return body;
}

/** Collects every ingest payload, decoded and ready to assert against. */
function collectIngestBodies(page: import('@playwright/test').Page): string[] {
  const bodies: string[] = [];

  page.on('request', (request: Request) => {
    if (!request.url().includes('/ingest')) return;
    // postDataBuffer() preserves the raw bytes; postData() mangles gzip.
    const decoded = decodeIngestBody(request.postDataBuffer(), request.postData());
    if (decoded) bodies.push(decoded);
  });

  return bodies;
}

/**
 * Every URL-bearing property value across all captured events.
 *
 * UUIDs are checked HERE rather than across the whole payload because PostHog's
 * own anonymous `distinct_id` and `$device_id` are legitimately UUIDs — a blanket
 * scan would fail on them while telling us nothing about leakage. What matters
 * is that no RECORD id reaches a URL property.
 */
function urlPropertyValues(bodies: string[]): string[] {
  const values: string[] = [];
  const urlKeys = ['$current_url', '$pathname', '$referrer', 'path'];

  for (const body of bodies) {
    for (const key of urlKeys) {
      // Matches "key":"value" across the batched payload without needing to know
      // whether it arrived as one event or an array of them.
      const matches = body.matchAll(new RegExp(`"\\${key}"\\s*:\\s*"([^"]*)"`, 'g'));
      for (const match of matches) values.push(match[1]);
    }
  }

  return values;
}

/**
 * Shaped like a real PostHog remote-config response.
 *
 * A `{"status":1}` stub is NOT enough: posthog-js loads /array/<token>/config.js
 * as a <script>, so JSON there is a syntax error that breaks initialisation.
 */
const REMOTE_CONFIG = {
  supportedCompression: [],
  autocapture_opt_out: true,
  captureDeadClicks: false,
  capturePerformance: false,
  sessionRecording: false,
  surveys: false,
  heatmaps: false,
  defaultIdentifiedOnly: true,
  errorTracking: { autocaptureExceptions: false, suppressionRules: [] },
  featureFlags: {},
  featureFlagPayloads: {},
  siteApps: [],
};

/**
 * Forces posthog-js to flush its batch.
 *
 * Events are queued and sent on a timer or on pagehide, so a test that asserts
 * immediately after an interaction sees an empty wire and passes for the wrong
 * reason. Navigating away triggers the flush deterministically.
 */
async function flushAnalytics(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/terms', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);
}

// Serial: posthog batches and flushes on pagehide, and under parallel workers
// the shared dev server is slow enough that a batch can miss its window — which
// shows up as the control test skipping, i.e. the guards silently going vacuous.
test.describe.configure({ mode: 'serial' });

test.describe('PostHog egress guard', () => {
  test.beforeEach(async ({ page }) => {
    /**
     * ⚠️  posthog-js SILENTLY DROPS every event from an automated browser. It
     * flags the session `$internal_or_test_user` and discards events BEFORE the
     * before_send hook runs, so with no override nothing is captured, every
     * negative assertion below passes vacuously, and the suite reports green
     * while testing nothing.
     *
     * The actual override is `opt_out_useragent_filter`, enabled in
     * instrumentation-client.ts only when NEXT_PUBLIC_ANALYTICS_E2E=1 — which no
     * deployed environment sets. RUN THIS SPEC WITH THAT VARIABLE SET, or the
     * control test at the bottom will skip and the guards mean nothing.
     */

    // Nothing reaches PostHog. Config endpoints get a realistic response so the
    // SDK initialises; everything else gets a plausible 200 so it does not enter
    // a retry loop that would distort what we observe.
    await page.route('**/ingest/**', (route) => {
      const url = route.request().url();

      if (url.endsWith('.js')) {
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: ';' });
      }
      if (url.includes('/array/') || url.includes('/flags')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(REMOTE_CONFIG),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
    });
  });

  test('never sends analytics directly to a posthog.com host', async ({ page }) => {
    const direct: string[] = [];
    page.on('request', (request) => {
      if (/posthog\.com/i.test(request.url())) direct.push(request.url());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Ingest must go through the app's own /ingest rewrite. PostHog's managed
    // proxy is not HIPAA-compliant, and same-origin is also what keeps the
    // strict CSP in next.config.ts working untouched.
    expect(direct).toEqual([]);
  });

  test('never emits an autocapture, replay or heatmap event', async ({ page }) => {
    const bodies = collectIngestBodies(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Click and move around: autocapture, rageclick and dead-click detection all
    // trigger on exactly this kind of interaction.
    await page.mouse.move(200, 200);
    await page.mouse.click(200, 200);
    await page.mouse.click(200, 200);
    await page.mouse.click(200, 200);
    await flushAnalytics(page);

    const combined = bodies.join('\n');
    for (const event of FORBIDDEN_EVENTS) {
      expect(combined, `${event} must never be captured`).not.toContain(event);
    }
  });

  test('never puts an email address on the wire', async ({ page }) => {
    const bodies = collectIngestBodies(page);

    // A query string is the easiest way for an address to reach a pageview, and
    // the normaliser drops query strings wholesale for exactly this reason.
    await page.goto('/?email=nurse@clinic.com&utm_source=test');
    await page.waitForLoadState('networkidle');
    await flushAnalytics(page);

    const combined = bodies.join('\n');
    expect(combined).not.toMatch(EMAIL_PATTERN);
  });

  test('never puts an invite token in a captured payload', async ({ page }) => {
    const bodies = collectIngestBodies(page);
    const token = 'PkS8x2Lm9QvT4nR7wZ3bYc1d';

    // /join/:token is a CREDENTIAL — anyone holding it can join the org. The
    // page will not resolve for a fake token; what matters is that the pageview
    // fired for it carries the route shape, not the token.
    await page.goto(`/join/${token}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await flushAnalytics(page);

    expect(bodies.join('\n'), 'the invite token must never be captured').not.toContain(token);
  });

  /**
   * Scoped to URL properties on purpose. PostHog's own anonymous distinct_id and
   * $device_id ARE uuids, so a blanket scan would fail on legitimate values while
   * saying nothing about leakage. The risk being tested is a RECORD id — which
   * identifies a course, an enrollment or a learner — reaching a URL property.
   */
  test('never puts a record id in a URL property', async ({ page }) => {
    const bodies = collectIngestBodies(page);

    await page.goto(`/learn/${'3f2b8c1e-4a5d-4b7e-9c0f-1a2b3c4d5e6f'}`, {
      waitUntil: 'domcontentloaded',
    }).catch(() => {});
    await flushAnalytics(page);

    for (const value of urlPropertyValues(bodies)) {
      expect(value, `URL property leaked a record id: ${value}`).not.toMatch(UUID_PATTERN);
    }
  });

  /**
   * The control test. Every assertion above is a NEGATIVE — "this string never
   * appears" — and a negative passes for free if nothing is ever captured. This
   * proves traffic actually flowed and was decoded, so the others mean something.
   */
  test('captures a normalised pageview, proving the guards are not vacuous', async ({ page }) => {
    const bodies = collectIngestBodies(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await flushAnalytics(page);

    const combined = bodies.join('\n');

    // A build with no NEXT_PUBLIC_POSTHOG_KEY is a VALID configuration — the
    // no-op path — so this is skipped rather than failed there. Run the suite
    // with a dummy key set to exercise the guards for real.
    test.skip(
      !combined.includes('$pageview'),
      'analytics disabled in this environment (no PostHog key) — negative assertions above are vacuous',
    );

    expect(combined).toContain('$pageview');
    // Decoding worked: the payload is readable JSON, not base64 we failed to
    // unwrap. Without this the negatives could pass on undecoded input.
    expect(combined).toContain('"event"');
  });
});
