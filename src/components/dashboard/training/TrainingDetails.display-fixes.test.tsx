/**
 * Regression guards for three display bugs the Figma-hero rework fixed:
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
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/components/ui', () => ({
  RowActionsMenu: () => <button type="button">Actions</button>,
}));

import TrainingDetails from './TrainingDetails';
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

describe('TrainingDetails — subtitle renders the real description', () => {
  it('renders course.description verbatim, never the old hardcoded subtitle', () => {
    // `overview` set to distinct text so the "Course Overview" section (which
    // falls back to `description` when there's no overview) doesn't echo the
    // same string and make the assertion ambiguous.
    render(
      <TrainingDetails
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
    render(<TrainingDetails course={baseCourse({ description: null })} />);

    expect(screen.queryByText(HARDCODED_SUBTITLE)).not.toBeInTheDocument();
  });
});

describe('TrainingDetails — pass mark fallback (lesson quiz -> course quiz)', () => {
  it('shows the real pass mark for a video course whose quiz attaches to the COURSE, not a lesson', () => {
    render(
      <TrainingDetails
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
      <TrainingDetails
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
      <TrainingDetails
        course={baseCourse({
          lessons: [{ id: 'lesson-1', title: 'Intro', videoStorageUri: null, quiz: null }],
          quiz: null,
        })}
      />,
    );

    expect(screen.queryByText(/Pass mark/)).not.toBeInTheDocument();
  });
});

describe('TrainingDetails — read/watch time hides rather than inventing a default', () => {
  it('hides the duration chip when it cannot be computed — no invented "10 min read"', () => {
    render(
      <TrainingDetails
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
      <TrainingDetails
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
      <TrainingDetails
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
