/**
 * `notFound` and `forbidden` must be indistinguishable to the caller — telling
 * an unauthorized viewer that a course exists (a distinct message from "it
 * doesn't") is itself a disclosure. This pins that identity so a future
 * "helpful" error-message change can't quietly turn the response into an
 * existence oracle. See src/lib/course/load-course-detail.ts for the consumer
 * that depends on the `reason` field (not the message) to decide control flow.
 */
import { describe, it, expect } from 'vitest';
import { CourseAccessError, isCourseAccessError } from './access-error';

describe('CourseAccessError', () => {
  it('carries the reason it was constructed with', () => {
    expect(new CourseAccessError('unauthenticated').reason).toBe('unauthenticated');
    expect(new CourseAccessError('notFound').reason).toBe('notFound');
    expect(new CourseAccessError('forbidden').reason).toBe('forbidden');
  });

  it('is named CourseAccessError so it is identifiable even if instanceof is defeated (e.g. across a module boundary)', () => {
    expect(new CourseAccessError('forbidden').name).toBe('CourseAccessError');
  });

  it('notFound and forbidden share the EXACT SAME user-facing message — an authorization denial must not reveal that the course exists', () => {
    const notFound = new CourseAccessError('notFound');
    const forbidden = new CourseAccessError('forbidden');

    expect(forbidden.message).toBe(notFound.message);
    expect(forbidden.message).toBe('Course not found');
  });

  it('unauthenticated gets its own distinct message (there is somewhere useful for an unauthenticated caller to go)', () => {
    expect(new CourseAccessError('unauthenticated').message).toBe('Unauthorized');
  });
});

describe('isCourseAccessError', () => {
  it('recognizes a genuine CourseAccessError', () => {
    expect(isCourseAccessError(new CourseAccessError('notFound'))).toBe(true);
  });

  it('rejects a plain Error with the identical message — the type, not the text, is the signal', () => {
    expect(isCourseAccessError(new Error('Course not found'))).toBe(false);
  });

  it('rejects a non-error value', () => {
    expect(isCourseAccessError('Course not found')).toBe(false);
    expect(isCourseAccessError(null)).toBe(false);
    expect(isCourseAccessError(undefined)).toBe(false);
  });
});
