/**
 * D8/D10 — the hero's attribution line, which moved here from TrainingDetails
 * when the hero itself moved to the preview page (the two course pages had
 * merged into one; the detail page is now the light management view).
 *
 * `approvedBy` records who signed the publish off (D8), but is a permanent,
 * reachable null: every course published before D8 shipped, any clean draft
 * `publishCourseOnAssignment` publishes as a side effect of being assigned
 * (D9), and every VIDEO course — those are uploaded system-wide and never go
 * through approval at all — never get a reviewer recorded. The hero falls back
 * to the CREATOR under a different label ("Created by") in that case, so the
 * line never implies a review that did not happen.
 *
 * `email` is selected on both `approvedBy.user` and `creator.user`
 * (src/types/course.ts) specifically so this fallback has something to show
 * when `fullName` is null — without it the line would render with a blank
 * where the name goes.
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

function baseCourse(overrides: Record<string, unknown> = {}): CourseWithRelations {
  return {
    id: 'course-1',
    title: 'Infection Control',
    description: null,
    overview: null,
    type: 'document',
    duration: 30,
    status: 'published',
    reviewRequired: false,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    objectives: [],
    skillLevel: null,
    previewVideoStorageUri: null,
    modules: [],
    quiz: null,
    lessons: [],
    enrollments: [],
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

describe('CoursePreview — attribution line (D10)', () => {
  it('shows "Approved by: {fullName} ({role})" when a reviewer was recorded', () => {
    render(
      <CoursePreview
        course={baseCourse({
          approvedBy: {
            role: 'hr',
            user: { email: 'reviewer@example.com', fullName: 'Rita Reviewer' },
          },
        })}
      />,
    );

    expect(screen.getByText('Approved by: Rita Reviewer (HR)')).toBeInTheDocument();
    expect(screen.queryByText(/Created by/)).not.toBeInTheDocument();
  });

  it('falls back to "Created by: {creator fullName} ({role})" when approvedBy is null', () => {
    render(<CoursePreview course={baseCourse({ approvedBy: null })} />);

    expect(screen.getByText('Created by: Ada Author (Admin)')).toBeInTheDocument();
    expect(screen.queryByText(/Approved by/)).not.toBeInTheDocument();
  });

  it('falls back to the reviewer’s email when their fullName is null', () => {
    render(
      <CoursePreview
        course={baseCourse({
          approvedBy: {
            role: 'clinical_director',
            user: { email: 'no-name-reviewer@example.com', fullName: null },
          },
        })}
      />,
    );

    expect(
      screen.getByText('Approved by: no-name-reviewer@example.com (Clinical Director)'),
    ).toBeInTheDocument();
  });

  it('falls back to the creator’s email when their fullName is null (null approvedBy branch)', () => {
    render(
      <CoursePreview
        course={baseCourse({
          approvedBy: null,
          creator: {
            userId: 'u-author',
            organizationId: 'org-1',
            role: 'supervisor',
            user: { email: 'no-name-creator@example.com', fullName: null },
          },
        })}
      />,
    );

    expect(
      screen.getByText('Created by: no-name-creator@example.com (Facility Supervisor)'),
    ).toBeInTheDocument();
  });

  // The guard this file most needs: a VIDEO course used to have its attribution
  // suppressed outright (`creatorName && !isVideoCourse`), so the one course
  // type that can NEVER be approved also showed nobody at all.
  it('shows "Created by" for a video course, which never goes through approval', () => {
    render(
      <CoursePreview
        course={baseCourse({
          type: 'video',
          approvedBy: null,
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

    expect(screen.getByText('Created by: Ada Author (Admin)')).toBeInTheDocument();
  });

  it('renders no attribution line at all when neither relation is present', () => {
    render(<CoursePreview course={baseCourse({ approvedBy: null, creator: null })} />);

    expect(screen.queryByText(/Approved by/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Created by/)).not.toBeInTheDocument();
  });
});
