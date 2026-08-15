/**
 * The analytics event allowlist.
 *
 * This file is the whole PHI story for product analytics. PostHog holds no BAA
 * for this project, so instead of trusting call sites not to send the wrong
 * thing, the type system refuses to compile them:
 *
 *   - Only a key of AnalyticsEventProperties can be captured. A typo, or an
 *     event someone invented at a call site, is a build error.
 *   - Each event declares its EXACT property shape. An extra property is a build
 *     error, so there is no "just add the document text and we'll filter later".
 *   - Property types are restricted to primitives (see EventProperties). Free
 *     text on this app means course content generated from clinical source
 *     documents, and an object is the natural way for it to escape.
 *
 * Runtime scrubbing in sanitize.ts still applies — these are two independent
 * controls, and neither is a reason to relax the other.
 *
 * ADDING AN EVENT: declare it below with a comment saying what question it
 * answers, then read docs/analytics.md. Never add a property that carries
 * learner-authored text, document content, quiz answers, email addresses, names,
 * or anything from a URL that has not been through normalizePath().
 */

/** Primitives only — an object or array is a channel for free text. */
type EventPropertyValue = string | number | boolean | null | undefined;
export type EventProperties = Record<string, EventPropertyValue>;

/**
 * Every event, mapped to the exact properties it carries.
 *
 * Naming: snake_case, `subject_verbPast` — the thing, then what happened to it.
 * Past tense because an event is a record of something that already occurred.
 */
export interface AnalyticsEventProperties {
  /* ── Marketing ─────────────────────────────────────────────────────────────
   * Public, unauthenticated pages. No person profile is created for these
   * visitors (person_profiles: 'identified_only'), so they are aggregate-only
   * until the visitor signs up and the session is aliased.
   */

  /** Which acquisition surfaces actually lead anywhere. */
  marketing_page_viewed: {
    /** Route SHAPE only — always via normalizePath(). */
    path: string;
    referrer_host: string | null;
  };

  /** The top of the sales funnel; the conversion the marketing site exists for. */
  demo_requested: {
    /** Bucketed, never the raw count, so it cannot fingerprint one org. */
    organization_size_band: string | null;
    has_message: boolean;
  };

  /** Whether self-serve help deflects support load, and where it fails. */
  help_search_performed: {
    /** Length only. The QUERY ITSELF IS NEVER SENT — staff search real scenarios. */
    query_length: number;
    result_count: number;
    surface: 'marketing' | 'dashboard' | 'worker';
  };

  help_article_viewed: {
    article_slug: string;
    surface: 'marketing' | 'dashboard' | 'worker';
  };

  /* ── Auth & onboarding funnel ──────────────────────────────────────────────
   * The clearest conversion funnel in the product: signup → verify → org setup
   * → first course. Drop-off between these steps is the main thing this whole
   * integration exists to measure.
   */

  signup_started: { entry_point: 'marketing' | 'invite' | 'direct' };

  signup_submitted: { used_captcha: boolean };

  email_verification_sent: { resend: boolean };

  email_verified: {
    /** How long verification took, to justify reminder cadence. */
    minutes_since_sent: number | null;
  };

  login_succeeded: {
    portal: 'admin' | 'worker';
    method: 'credentials' | 'microsoft';
    mfa_required: boolean;
  };

  /**
   * `reason` is a FIXED enum, never a raw error string — a thrown message can
   * echo an address or a database value.
   */
  login_failed: {
    portal: 'admin' | 'worker';
    reason: 'bad_credentials' | 'unverified' | 'locked' | 'role_mismatch' | 'no_membership';
  };

  mfa_challenge_sent: { portal: 'admin' | 'worker' };
  mfa_verified: { portal: 'admin' | 'worker'; attempts: number };

  /** Multi-org users: how often identity switching actually happens. */
  organization_selected: { membership_count: number };

  onboarding_step_viewed: { step: number };
  onboarding_step_completed: { step: number; seconds_on_step: number | null };
  onboarding_completed: { total_minutes: number | null; steps_skipped: number };

  invite_accepted: { role: string; days_since_invited: number | null };

  /* ── Admin portal ──────────────────────────────────────────────────────────
   * The paying customer's surface. These answer "is this org getting value",
   * which is the churn signal.
   */

  document_uploaded: {
    file_type: string;
    /** Bucketed to avoid fingerprinting a specific document. */
    size_band: 'small' | 'medium' | 'large';
    page_count: number | null;
  };

  /** The AI pipeline as the ADMIN experiences it. Cost/latency lives in llm.ts. */
  course_generation_started: {
    source: 'document' | 'topic' | 'video';
    requested_quiz_count: number;
  };
  course_generation_completed: {
    duration_seconds: number;
    lesson_count: number;
    quiz_count: number;
  };
  course_generation_failed: {
    /** Fixed enum — never the raw error text, which can echo document content. */
    stage: 'article' | 'slides' | 'quiz' | 'judge' | 'regen' | 'unknown';
    reason: 'timeout' | 'insufficient_source' | 'model_error' | 'validation' | 'unknown';
  };

  /** The activation moment: an org that never publishes never gets value. */
  course_published: { lesson_count: number; has_quiz: boolean; has_video: boolean };

  course_assigned: {
    /** Bucketed — a raw headcount can identify a specific customer. */
    assignee_count_band: string;
    method: 'individual' | 'role' | 'facility' | 'all';
  };

  retake_assigned: { reason: 'failed_quiz' | 'recurrence' | 'manual' };

  staff_invited: { role: string; batch_size_band: string };
  staff_role_changed: { from_role: string; to_role: string };

  /** The compliance deliverable — the reason a facility buys this product. */
  audit_report_exported: { format: 'pdf' | 'xlsx' | 'docx'; range_days: number | null };

  billing_plan_change_started: {
    from_plan: string;
    to_plan: string;
    direction: 'upgrade' | 'downgrade';
  };
  billing_plan_change_completed: { from_plan: string; to_plan: string };

  /* ── Worker / learner portal ───────────────────────────────────────────────
   * Highest event volume, and the surface where clinical course content is on
   * screen. Nothing here may carry course text, question text, or answers.
   */

  course_started: { course_id: string; is_retake: boolean; assigned_days_ago: number | null };

  lesson_completed: {
    course_id: string;
    lesson_index: number;
    content_type: 'article' | 'slides' | 'video';
  };

  course_completed: { course_id: string; total_minutes: number | null; is_retake: boolean };

  quiz_started: { course_id: string; question_count: number; attempt_number: number };

  /** Score is a number, never the answers. */
  quiz_submitted: {
    course_id: string;
    score_percent: number;
    passed: boolean;
    attempt_number: number;
    duration_seconds: number | null;
  };

  certificate_downloaded: { course_id: string; format: 'pdf' };

  attestation_signed: { course_id: string };

  /* ── LLM analytics ─────────────────────────────────────────────────────────
   * PostHog's LLM analytics product reads the `$ai_`-prefixed properties on
   * `$ai_generation` and derives cost, latency and token dashboards from them.
   *
   * It is declared HERE, in the same allowlist as every product event, rather
   * than given its own capture path — so it inherits the same egress guard and
   * the same sanitiser. That matters more for this event than any other:
   *
   * PostHog's schema also defines `$ai_input` and `$ai_output_choices`, which
   * carry the prompt and completion verbatim. On this app the prompt IS the
   * source document — the clinical material a facility uploaded. They are
   * therefore ABSENT from this type by design, which makes sending them a
   * compile error rather than a decision anyone has to remember not to make.
   */
  $ai_generation: {
    /** Ties stages A-E of one course generation into a single trace. */
    $ai_trace_id: string;
    /** Labels this node in PostHog's trace view — carries the pipeline stage. */
    $ai_span_name: string;
    $ai_model: string;
    $ai_provider: 'google';
    $ai_input_tokens: number;
    $ai_output_tokens: number;
    /**
     * SECONDS, not milliseconds. Verified against PostHog's taxonomy:
     * "The latency of the request made to the LLM API, in seconds."
     */
    $ai_latency: number;
    $ai_is_error: boolean;
    /**
     * Vertex's finishReason (STOP / MAX_TOKENS / SAFETY). A closed vocabulary
     * from the API, never free text.
     *
     * NOTE: `$ai_error` also exists in PostHog's schema and holds the RAW error.
     * It is deliberately not declared here — a Vertex error body echoes the
     * request, which on this app is source-document text.
     */
    $ai_stop_reason: string | null;
    /** Classified, never raw. See classifyAiError() in llm.ts. */
    $ai_error_type: 'timeout' | 'rate_limit' | 'server_error' | 'no_content' | 'unknown' | null;
    /**
     * Retry index. The Vertex client retries 429/5xx internally, so a stage that
     * only succeeds on its third attempt looks healthy in latency alone.
     */
    attempt: number;
  };

  /* ── Cross-surface ─────────────────────────────────────────────────────── */

  /**
   * Manual pageview. capture_pageview is OFF in the SDK because PostHog's
   * automatic one sends `$current_url` verbatim, which on this app would ship
   * the /join/:token invite credential to a third party.
   */
  $pageview: {
    /** Route SHAPE only — always via normalizePath(). */
    path: string;
    portal: 'marketing' | 'auth' | 'admin' | 'worker' | 'onboarding' | 'system';
  };
}

export type AnalyticsEvent = keyof AnalyticsEventProperties;

/**
 * Runtime allowlist, derived from the same source of truth as the types.
 *
 * The type constraint alone protects TypeScript call sites. This set is the
 * belt-and-braces check used by the client's before_send hook, which sees events
 * the SDK itself may originate (survey callbacks, exception autocapture,
 * anything a future PostHog feature adds) — none of which pass through our
 * typed helpers at all.
 */
export const ALLOWED_EVENTS: ReadonlySet<string> = new Set<AnalyticsEvent>([
  'marketing_page_viewed',
  'demo_requested',
  'help_search_performed',
  'help_article_viewed',
  'signup_started',
  'signup_submitted',
  'email_verification_sent',
  'email_verified',
  'login_succeeded',
  'login_failed',
  'mfa_challenge_sent',
  'mfa_verified',
  'organization_selected',
  'onboarding_step_viewed',
  'onboarding_step_completed',
  'onboarding_completed',
  'invite_accepted',
  'document_uploaded',
  'course_generation_started',
  'course_generation_completed',
  'course_generation_failed',
  'course_published',
  'course_assigned',
  'course_started',
  'course_completed',
  'retake_assigned',
  'staff_invited',
  'staff_role_changed',
  'audit_report_exported',
  'billing_plan_change_started',
  'billing_plan_change_completed',
  'lesson_completed',
  'quiz_started',
  'quiz_submitted',
  'certificate_downloaded',
  'attestation_signed',
  '$ai_generation',
  '$pageview',
]);

/**
 * PostHog-internal events that are permitted through before_send even though
 * they are not product events we declare.
 *
 * `$feature_flag_called` is what makes experiment analysis work — without it an
 * experiment cannot attribute a conversion to a variant. `$identify` and
 * `$groupidentify` carry the identity and org association. They are listed
 * explicitly so the guard stays deny-by-default rather than prefix-based.
 */
export const ALLOWED_INTERNAL_EVENTS: ReadonlySet<string> = new Set([
  '$feature_flag_called',
  '$identify',
  '$groupidentify',
  '$pageleave',
  '$set',
]);

export function isAllowedEvent(eventName: string): boolean {
  return ALLOWED_EVENTS.has(eventName) || ALLOWED_INTERNAL_EVENTS.has(eventName);
}

/**
 * Bucket a count so it describes a cohort rather than identifying an org.
 *
 * A raw "invited 47 staff" is close to a fingerprint for a specific customer
 * when combined with anything else; the band answers the product question
 * ("do bulk inviters retain better?") without the precision.
 *
 * TODO(bands): these boundaries are a placeholder based on nothing. They should
 * reflect the actual distribution of facility sizes in the customer base — if
 * most orgs land inside one band, every cohort comparison built on this is
 * comparing a group against itself. See docs/analytics.md.
 */
export function toCountBand(count: number): string {
  if (count <= 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  if (count <= 50) return '21-50';
  if (count <= 200) return '51-200';
  return '200+';
}
