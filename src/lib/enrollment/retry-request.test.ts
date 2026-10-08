import { describe, it, expect } from 'vitest';
import {
  RETRY_REQUEST_COOLDOWN_MS,
  decideRetryRequest,
  retryRequestCooldownStart,
  retryRequestUiState,
  type RetryRequestFacts,
} from './retry-request';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function facts(overrides: Partial<RetryRequestFacts> = {}): RetryRequestFacts {
  return {
    status: 'locked',
    retryRequestedAt: null,
    courseArchived: false,
    hasRetake: false,
    billingActive: true,
    now: NOW,
    ...overrides,
  };
}

describe('decideRetryRequest', () => {
  it('admits a locked enrolment with no request, no retake and live billing', () => {
    expect(decideRetryRequest(facts())).toBe('eligible');
  });

  it.each([
    'enrolled',
    'assigned',
    'in_progress',
    'lessons_complete',
    'completed',
    'attested',
    'failed',
    'retry_requested',
  ] as const)('refuses a %s enrolment as not_locked', (status) => {
    expect(decideRetryRequest(facts({ status }))).toBe('not_locked');
  });

  it('refuses an archived course before anything else', () => {
    expect(
      decideRetryRequest(
        facts({ courseArchived: true, billingActive: false, status: 'completed', hasRetake: true }),
      ),
    ).toBe('archived');
  });

  it('refuses a billing-paused organization before the enrolment state', () => {
    expect(decideRetryRequest(facts({ billingActive: false, status: 'completed' }))).toBe(
      'billing_paused',
    );
  });

  it('refuses once a retake exists', () => {
    expect(decideRetryRequest(facts({ hasRetake: true }))).toBe('retake_exists');
  });

  it('reports already_requested inside the 72-hour cool-down', () => {
    const retryRequestedAt = new Date(NOW.getTime() - 71 * HOUR);
    expect(decideRetryRequest(facts({ retryRequestedAt }))).toBe('already_requested');
  });

  it('admits a repeat once 72 hours have passed', () => {
    const retryRequestedAt = new Date(NOW.getTime() - RETRY_REQUEST_COOLDOWN_MS);
    expect(decideRetryRequest(facts({ retryRequestedAt }))).toBe('eligible');
  });
});

describe('retryRequestCooldownStart', () => {
  it('is exactly 72 hours before now', () => {
    expect(retryRequestCooldownStart(NOW).getTime()).toBe(NOW.getTime() - 72 * HOUR);
  });
});

describe('retryRequestUiState', () => {
  it('offers the request on a locked enrolment never requested', () => {
    expect(retryRequestUiState({ status: 'locked', retryRequestedAt: null, now: NOW })).toBe(
      'available',
    );
  });

  it('is pending inside the cool-down, from a Date or an ISO string', () => {
    const at = new Date(NOW.getTime() - HOUR);
    expect(retryRequestUiState({ status: 'locked', retryRequestedAt: at, now: NOW })).toBe(
      'pending',
    );
    expect(
      retryRequestUiState({ status: 'locked', retryRequestedAt: at.toISOString(), now: NOW }),
    ).toBe('pending');
  });

  it('offers the request again after the cool-down', () => {
    const at = new Date(NOW.getTime() - 73 * HOUR);
    expect(retryRequestUiState({ status: 'locked', retryRequestedAt: at, now: NOW })).toBe(
      'available',
    );
  });

  it('shows nothing for an unlocked enrolment or one with a retake', () => {
    expect(retryRequestUiState({ status: 'in_progress', retryRequestedAt: null, now: NOW })).toBe(
      'none',
    );
    expect(
      retryRequestUiState({
        status: 'locked',
        retryRequestedAt: null,
        hasRetake: true,
        now: NOW,
      }),
    ).toBe('none');
  });
});
