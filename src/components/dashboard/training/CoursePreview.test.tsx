/**
 * Tests for CoursePreview's dashboard banner-slot fix (#32). The reported
 * symptom — the site-wide BillingPausedBanner getting painted over — was
 * caused by an unconditional `-m-10` on the hero pulling it up over whatever
 * preceded it in the dashboard's scroll container, including the banner.
 * The fix scopes the pull to `first:-mt-10` on the root (only applies when
 * nothing precedes this page — i.e. no banner) and moves the horizontal pull
 * to `-mx-10` on the hero itself.
 *
 * This is layout-only: Tailwind classes aren't resolved to computed styles in
 * jsdom, so geometry (whether the hero actually overlaps the banner) can't be
 * asserted here — only the className contract that the fix relies on. The
 * visual behavior is unverified by this suite without a real browser.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { CourseWithRelations } from '@/types/course';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/actions/course', () => ({ startCourse: vi.fn() }));
vi.mock('@/app/actions/enrollment', () => ({ requestCourseRetry: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

import CoursePreview from './CoursePreview';

function baseCourse(overrides: Partial<CourseWithRelations> = {}): CourseWithRelations {
  return {
    id: 'course-1',
    title: 'Infection Control',
    description: null,
    overview: null,
    type: 'document',
    duration: 30,
    status: 'published',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    objectives: [],
    skillLevel: null,
    previewVideoStorageUri: null,
    modules: [],
    quiz: null,
    lessons: [],
    creator: null,
    ...overrides,
  } as unknown as CourseWithRelations;
}

describe('CoursePreview — banner-slot layout contract (#32)', () => {
  it('scopes the vertical pull to first:-mt-10 on the root, not an unconditional -m-10', () => {
    const { container } = render(<CoursePreview course={baseCourse()} />);

    const root = container.firstElementChild;
    expect(root).toHaveClass('first:-mt-10');
    expect(root?.className.split(/\s+/)).not.toContain('-m-10');
  });

  it('keeps the horizontal pull on the hero itself via -mx-10, separate from the root', () => {
    const { container } = render(<CoursePreview course={baseCourse()} />);

    const root = container.firstElementChild as HTMLElement;
    const hero = root.firstElementChild as HTMLElement;

    expect(hero).toHaveClass('-mx-10');
    expect(hero).not.toHaveClass('first:-mt-10');
  });
});
