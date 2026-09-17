/**
 * Regression guards for three display bugs the Figma-hero rework fixed. They
 * moved here from TrainingDetails with the hero itself — the detail page is now
 * the light management view and carries none of these chips.
 *
 *   1. The subtitle was a hardcoded string ("Mandatory annual training aligned
 *      with organizational standards") on EVERY course. It now renders
 *      `course.description`.
 *   2. Read time defaulted to `|| 10` whenever it could not be computed,
 *      inventing a duration that was never in the data.
 *   3. Pass mark defaulted to `|| 80` — for a VIDEO course specifically, whose
 *      quiz attaches to the COURSE (not a lesson), this fabricated an 80% pass
 *      mark that was never configured. Pass mark now falls back
 *      lesson-quiz -> course-quiz, and hides entirely when genuinely absent,
 *      rather than showing an invented default.
 *
 * Plus a fourth, introduced by the move: the preview hero's status pill was
 * hardcoded to `published ? 'Active' : 'Inactive'`, which read a draft held by
 * the F-051 quality gate as merely "Inactive". It now uses the same
 * `courseStatusBadge` helper the rest of the product does.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

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
import type { CourseWithRelations } from '@/types/course';

const HARDCODED_SUBTITLE = 'Mandatory annual training aligned with organizational standards';

// Untyped on purpose: these fixtures deliberately provide partial lesson/quiz
// shapes (only the fields the component actually reads), which a
// `Partial<CourseWithRelations>` parameter would reject as incomplete against
// the full Prisma-derived nested types.
function baseCourse(overrides: Record<string, unknown> = {}): CourseWithRelations {
  return {
    id: 'course-1',
    title: 'Infection Control',
    type: 'document',
    duration: null,
    status: 'published',
    reviewRequired: false,
    description: null,
    overview: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    objectives: [],
    skillLevel: null,
    previewVideoStorageUri: null,
    modules: [],
    lessons: [],
    enrollments: [],
    quiz: null,
    creator: {
      userId: 'u-author',
      organizationId: 'org-1',
      role: 'admin',
      user: { email: 'author@example.com', fullName: 'Ada Author' },
    },
    approvedBy: null,
    ...overrides,
  } as unknown as CourseWithRelations;
}

describe('CoursePreview — subtitle renders the real description', () => {
  it('renders course.description verbatim, never the old hardcoded subtitle', () => {
    // `overview` set to distinct text so the "Course Overview" section (which
    // falls back to `description` when there's no overview) doesn't echo the
    // same string and make the assertion ambiguous.
    render(
      <CoursePreview
        course={baseCourse({
          description: 'A short course on hand hygiene procedures.',
          overview: '<p>Full course overview content, distinct from the subtitle.</p>',
        })}
      />,
    );

    expect(screen.getByText('A short course on hand hygiene procedures.')).toBeInTheDocument();
    expect(screen.queryByText(HARDCODED_SUBTITLE)).not.toBeInTheDocument();
  });

  it('renders no subtitle line at all when the course has no description', () => {
    render(<CoursePreview course={baseCourse({ description: null })} />);

    expect(screen.queryByText(HARDCODED_SUBTITLE)).not.toBeInTheDocument();
  });
});

describe('CoursePreview — pass mark fallback (lesson quiz -> course quiz)', () => {
  it('shows the real pass mark for a video course whose quiz attaches to the COURSE, not a lesson', () => {
    render(
      <CoursePreview
        course={baseCourse({
          type: 'video',
          lessons: [
            {
              id: 'lesson-1',
              title: 'Watch the video',
              videoStorageUri: 'minio://bucket/video.mp4',
              videoDurationSeconds: 300,
              quiz: null,
            },
          ],
          quiz: { passingScore: 65 },
        })}
      />,
    );

    expect(screen.getByText('Pass mark: 65%')).toBeInTheDocument();
    // The bug this guards: video courses used to always show a fabricated 80%.
    expect(screen.queryByText('Pass mark: 80%')).not.toBeInTheDocument();
  });

  it('prefers the LESSON quiz pass mark over the course quiz when both exist (text course)', () => {
    render(
      <CoursePreview
        course={baseCourse({
          type: 'document',
          lessons: [
            { id: 'lesson-1', title: 'Intro', videoStorageUri: null, quiz: null },
            {
              id: 'lesson-2',
              title: 'Final assessment',
              videoStorageUri: null,
              quiz: { passingScore: 72 },
            },
          ],
          quiz: { passingScore: 80 },
        })}
      />,
    );

    expect(screen.getByText('Pass mark: 72%')).toBeInTheDocument();
    expect(screen.queryByText('Pass mark: 80%')).not.toBeInTheDocument();
  });

  it('hides the pass mark entirely when neither a lesson nor the course carries a quiz — no invented 80%', () => {
    render(
      <CoursePreview
        course={baseCourse({
          lessons: [{ id: 'lesson-1', title: 'Intro', videoStorageUri: null, quiz: null }],
          quiz: null,
        })}
      />,
    );

    expect(screen.queryByText(/Pass mark/)).not.toBeInTheDocument();
  });
});

describe('CoursePreview — read/watch time hides rather than inventing a default', () => {
  it('hides the duration chip when it cannot be computed — no invented "10 min read"', () => {
    render(
      <CoursePreview
        course={baseCourse({
          duration: null,
          lessons: [{ id: 'lesson-1', title: 'Intro', videoStorageUri: null, quiz: null }],
        })}
      />,
    );

    expect(screen.queryByText(/min read/)).not.toBeInTheDocument();
    expect(screen.queryByText(/min watch/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10 min/)).not.toBeInTheDocument();
  });

  it('shows the real course.duration as "N min read" for a text course', () => {
    render(
      <CoursePreview
        course={baseCourse({
          type: 'document',
          duration: 25,
          lessons: [{ id: 'lesson-1', title: 'Intro', videoStorageUri: null, quiz: null }],
        })}
      />,
    );

    expect(screen.getByText('25 min read')).toBeInTheDocument();
  });

  it('derives "N min watch" from the video lesson\'s real duration for a video course', () => {
    render(
      <CoursePreview
        course={baseCourse({
          type: 'video',
          duration: null,
          lessons: [
            {
              id: 'lesson-1',
              title: 'Watch the video',
              videoStorageUri: 'minio://bucket/video.mp4',
              videoDurationSeconds: 600,
              quiz: null,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('10 min watch')).toBeInTheDocument();
  });
});

describe('CoursePreview — status pill reports the real lifecycle state', () => {
  it('shows "Active" for a published course', () => {
    render(<CoursePreview course={baseCourse({ status: 'published', reviewRequired: false })} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows "Needs Review" — not "Inactive" — for a draft held by the F-051 quality gate', () => {
    render(<CoursePreview course={baseCourse({ status: 'draft', reviewRequired: true })} />);
    expect(screen.getByText('Needs Review')).toBeInTheDocument();
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('shows "Draft" for an ordinary unpublished draft', () => {
    render(<CoursePreview course={baseCourse({ status: 'draft', reviewRequired: false })} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
});
