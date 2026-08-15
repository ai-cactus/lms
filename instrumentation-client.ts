/**
 * Browser-side PostHog initialisation.
 *
 * Next.js runs this file once, before the app's client code (the client-side
 * counterpart to src/instrumentation.ts). It follows the same opt-in rule the
 * OTel registration uses: with NEXT_PUBLIC_POSTHOG_KEY unset, nothing is
 * imported, nothing is initialised, and no request is made — so local dev, CI
 * and the e2e build carry no analytics and cannot leak.
 *
 * ⚠️  NEXT_PUBLIC_* is inlined at BUILD time. The key must be supplied as a
 * Docker build arg (see Dockerfile), not only in the runtime env file, or the
 * shipped bundle has analytics permanently disabled with nothing to show for it.
 */
import posthog from 'posthog-js';
import { isAllowedEvent } from '@/lib/analytics/events';
import { normalizePath, sanitizeProperties } from '@/lib/analytics/sanitize';

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    // Same-origin ingest through the Next.js rewrites in next.config.ts.
    // PostHog's own managed proxy is documented as NOT HIPAA-compliant, and
    // routing through this app also keeps the strict CSP untouched.
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || '/ingest',
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || 'https://us.posthog.com',

    // Pins SDK behaviour to a known generation so a library upgrade cannot
    // silently switch on a new default that captures more than we intend.
    defaults: '2026-06-25',

    // ── The no-PHI posture ──────────────────────────────────────────────────
    // Autocapture reads DOM text and element context. On this app that means
    // staff names and clinically-derived course content, so it is off — this is
    // the single most important line in the file.
    autocapture: false,
    // Same reasoning, one layer down: rageclick/dead-click detection also
    // inspects the elements around a click.
    capture_dead_clicks: false,
    capture_heatmaps: false,
    // Exception autocapture ships raw error messages and stacks, and error text
    // is the least controlled string in this system — a Vertex failure echoes
    // the prompt (source-document text), a database error echoes column values.
    // Left OFF here and turned on deliberately once capture runs through
    // sanitizeErrorText(). Its default is `undefined`, which means remote config
    // can decide; pinning it to false removes that possibility.
    capture_exceptions: false,
    // Replay is a full DOM recording. Off here AND at the project level, since
    // remote config could otherwise re-enable it without a deploy.
    disable_session_recording: true,
    // Belt-and-braces: if replay were ever switched on, text is masked by default.
    mask_all_text: true,
    mask_all_element_attributes: true,
    // Anonymous marketing visitors create no person profile. This is what lets
    // us run without a consent banner: there is no profile to consent to until
    // a user signs in and is deliberately identified.
    person_profiles: 'identified_only',

    // PostHog's automatic pageview sends $current_url verbatim, which on this
    // app would ship the /join/:token invite credential. Pageviews are captured
    // manually from normalized paths instead (see PostHogProvider).
    capture_pageview: false,
    capture_pageleave: true,

    // Drop URL-ish properties the SDK attaches on its own. Belt-and-braces with
    // before_send below, which rewrites the ones we do want to keep.
    property_denylist: ['$initial_current_url', '$initial_pathname', '$initial_referrer'],

    /**
     * Deny-by-default egress guard — the last thing that runs before anything
     * leaves the browser.
     *
     * `sanitize_properties` can only scrub an event; returning null here DROPS
     * it. That difference matters because this hook also sees events our typed
     * helpers never touch — anything the SDK or a future PostHog feature
     * originates. An allowlist is the only way to be sure a library upgrade
     * cannot start sending something new.
     */
    before_send: (event) => {
      if (!event) return null;
      if (!isAllowedEvent(event.event)) return null;

      const properties = sanitizeProperties(event.properties ?? {});

      // URL-bearing properties are route-shaped rather than dropped, so funnels
      // still work while tokens and record ids never leave.
      for (const urlKey of ['$current_url', '$pathname', '$referrer', 'path'] as const) {
        const value = properties[urlKey];
        if (typeof value === 'string') properties[urlKey] = normalizePath(value);
      }

      return { ...event, properties };
    },
  });
}
