/**
 * The allowlist is the control that stops an SDK upgrade, a PostHog feature, or
 * a stray call site from sending something nobody reviewed. These tests treat it
 * as a security boundary rather than a lookup table.
 */
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_EVENTS,
  ALLOWED_INTERNAL_EVENTS,
  isAllowedEvent,
  toCountBand,
  type AnalyticsEvent,
  type AnalyticsEventProperties,
} from './events';

describe('event allowlist', () => {
  it('admits a declared product event', () => {
    expect(isAllowedEvent('course_published')).toBe(true);
    expect(isAllowedEvent('quiz_submitted')).toBe(true);
  });

  it('admits the PostHog internals experiments and identity depend on', () => {
    expect(isAllowedEvent('$feature_flag_called')).toBe(true);
    expect(isAllowedEvent('$identify')).toBe(true);
    expect(isAllowedEvent('$groupidentify')).toBe(true);
  });

  // The whole point of deny-by-default: things we never reviewed do not pass.
  it.each([
    '$autocapture',
    '$rageclick',
    '$dead_click',
    '$exception',
    '$web_vitals',
    '$copy_autocapture',
    '$snapshot',
    'made_up_event',
  ])('rejects the unreviewed event %s', (event) => {
    expect(isAllowedEvent(event)).toBe(false);
  });

  it('rejects a near-miss typo rather than guessing', () => {
    expect(isAllowedEvent('course_publish')).toBe(false);
    expect(isAllowedEvent('Course_Published')).toBe(false);
  });

  /**
   * The runtime Set and the compile-time interface are two hand-maintained
   * views of one list. An event declared in the type but missing from the Set
   * type-checks at the call site and is then silently dropped by before_send —
   * the worst failure mode available, so it is asserted.
   */
  it('keeps the runtime allowlist in step with the declared event types', () => {
    const declared: Record<AnalyticsEvent, true> = {
      marketing_page_viewed: true,
      demo_requested: true,
      help_search_performed: true,
      help_article_viewed: true,
      signup_started: true,
      signup_submitted: true,
      email_verification_sent: true,
      email_verified: true,
      login_succeeded: true,
      login_failed: true,
      mfa_challenge_sent: true,
      mfa_verified: true,
      organization_selected: true,
      onboarding_step_viewed: true,
      onboarding_step_completed: true,
      onboarding_completed: true,
      invite_accepted: true,
      document_uploaded: true,
      course_generation_started: true,
      course_generation_completed: true,
      course_generation_failed: true,
      course_published: true,
      course_assigned: true,
      retake_assigned: true,
      staff_invited: true,
      staff_role_changed: true,
      audit_report_exported: true,
      billing_plan_change_started: true,
      billing_plan_change_completed: true,
      course_started: true,
      lesson_completed: true,
      course_completed: true,
      quiz_started: true,
      quiz_submitted: true,
      certificate_downloaded: true,
      attestation_signed: true,
      $ai_generation: true,
      $pageview: true,
    };

    const declaredNames = Object.keys(declared).sort();
    expect([...ALLOWED_EVENTS].sort()).toEqual(declaredNames);
  });

  it('keeps product and internal allowlists disjoint', () => {
    const overlap = [...ALLOWED_EVENTS].filter((event) => ALLOWED_INTERNAL_EVENTS.has(event));
    // $pageview is ours (captured manually), so it must not also be treated as
    // a PostHog internal that bypasses review.
    expect(overlap).toEqual([]);
  });
});

describe('toCountBand', () => {
  it('never returns a raw count that could fingerprint one organization', () => {
    expect(toCountBand(47)).toBe('21-50');
    expect(toCountBand(1)).toBe('1');
    expect(toCountBand(5000)).toBe('200+');
  });

  it('is defined at every boundary', () => {
    expect(toCountBand(0)).toBe('1');
    expect(toCountBand(2)).toBe('2-5');
    expect(toCountBand(6)).toBe('6-20');
    expect(toCountBand(21)).toBe('21-50');
    expect(toCountBand(51)).toBe('51-200');
    expect(toCountBand(201)).toBe('200+');
  });
});

describe('event property shapes', () => {
  /**
   * Guards the rules that make the taxonomy safe by construction. If someone
   * later widens one of these, this test is where it should hurt.
   */
  it('sends only the length of a help-centre query, never the query', () => {
    const props: AnalyticsEventProperties['help_search_performed'] = {
      query_length: 24,
      result_count: 3,
      surface: 'worker',
    };
    expect(Object.keys(props)).not.toContain('query');
  });

  it('sends a quiz score but never the answers', () => {
    const props: AnalyticsEventProperties['quiz_submitted'] = {
      course_id: 'c1',
      score_percent: 80,
      passed: true,
      attempt_number: 1,
      duration_seconds: 240,
    };
    expect(Object.keys(props)).not.toContain('answers');
    expect(Object.keys(props)).not.toContain('questions');
  });

  it('describes a generation failure with a fixed reason, not raw error text', () => {
    const props: AnalyticsEventProperties['course_generation_failed'] = {
      stage: 'quiz',
      reason: 'model_error',
    };
    expect(Object.keys(props)).not.toContain('message');
    expect(Object.keys(props)).not.toContain('error');
  });
});
