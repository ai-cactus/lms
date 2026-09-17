/**
 * The course-detail page and the preview page had merged into one: everything
 * the design puts on Preview (dark hero, Course Overview, Table of Content,
 * "View Course") was rendering here, and Preview was a near-duplicate.
 *
 * This suite pins the split from the detail page's side:
 *   - what the light header must now carry (title + status pill, the linked
 *     policy document, Preview as the primary action and Assign beside it);
 *   - what must NOT be here any more, "View Course" above all — two entry
 *     points into the player on one screen was the symptom users saw;
 *   - the Facility column, which the design has always shown and the roster
 *     never rendered.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

vi.mock('@/components/ui', () => ({
  RowActionsMenu: () => <button type="button">Actions</button>,
}));

import TrainingDetails from './TrainingDetails';
import type { CourseWithRelations } from '@/types/course';

function baseCourse(overrides: Record<string, unknown> = {}): CourseWithRelations {
  return {
    id: 'course-1',
    title: 'Infection Control',
    description: 'A short course on hand hygiene.',
    overview: '<p>Everything you need to know.</p>',
    type: 'document',
    duration: 30,
    status: 'published',
    reviewRequired: false,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    objectives: ['Wash your hands'],
    skillLevel: 'beginner',
    lessons: [{ id: 'lesson-1', title: 'Intro', videoStorageUri: null, quiz: null }],
    enrollments: [],
    versions: [],
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

function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enr-1',
    organizationUserId: 'ou-1',
    status: 'completed',
    score: 90,
    progress: 100,
    organizationUser: {
      userId: 'u-1',
      role: 'clinician',
      user: { email: 'frank@example.com', fullName: 'Frank Doe' },
    },
    facility: { name: 'Northside Clinic' },
    certificate: null,
    ...overrides,
  };
}

describe('TrainingDetails — header actions', () => {
  it('offers "Preview" as a link to the preview route', () => {
    render(<TrainingDetails course={baseCourse()} />);

    expect(screen.getByRole('link', { name: 'Preview' })).toHaveAttribute(
      'href',
      '/dashboard/training/courses/course-1/preview',
    );
  });

  it('keeps "Assign" beside it', () => {
    render(<TrainingDetails course={baseCourse()} />);

    expect(screen.getByRole('button', { name: /Assign/ })).toBeInTheDocument();
  });

  // The whole point of the split: the player is reached via Preview now, so a
  // second call to action straight into /learn must not reappear here.
  it('does NOT render "View Course" — that lives on the preview page', () => {
    render(<TrainingDetails course={baseCourse()} />);

    expect(screen.queryByText(/View Course/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^\/learn/ })).not.toBeInTheDocument();
  });

  it('does not render the Course Overview or Table of Content sections', () => {
    render(<TrainingDetails course={baseCourse()} />);

    expect(screen.queryByText('Course Overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Table of Content')).not.toBeInTheDocument();
    expect(screen.queryByText(/What You.ll Learn/)).not.toBeInTheDocument();
  });
});

describe('TrainingDetails — linked policy document', () => {
  const lineage = (overrides: Record<string, unknown> = {}) => [
    {
      documentVersion: {
        documentId: 'doc-7',
        document: { originalName: 'CARF-Privacy-policy.pdf', archivedAt: null, ...overrides },
      },
    },
  ];

  it('links the source document by its original filename', () => {
    render(<TrainingDetails course={baseCourse({ versions: lineage() })} />);

    const link = screen.getByRole('link', { name: 'CARF-Privacy-policy.pdf' });
    expect(link).toHaveAttribute('href', '/dashboard/documents/doc-7');
    expect(screen.getByText(/Linked Policy Document:/)).toBeInTheDocument();
  });

  it('omits the line entirely for a course with no source document', () => {
    render(<TrainingDetails course={baseCourse({ versions: [] })} />);

    expect(screen.queryByText(/Linked Policy Document/)).not.toBeInTheDocument();
  });

  // The archive rule is a client extension on Document's own reads and cannot
  // reach this traversal, so an archived source still arrives here — and the
  // document viewer refuses it, making the link a guaranteed 404.
  it('omits the line when the source document has been archived', () => {
    render(
      <TrainingDetails
        course={baseCourse({ versions: lineage({ archivedAt: new Date('2026-02-01') }) })}
      />,
    );

    expect(screen.queryByText(/Linked Policy Document/)).not.toBeInTheDocument();
  });
});

describe('TrainingDetails — enrolled staff Facility column', () => {
  it('renders a Facility header and the facility recorded on the enrollment', () => {
    render(<TrainingDetails course={baseCourse({ enrollments: [enrollment()] })} />);

    expect(screen.getByRole('columnheader', { name: 'Facility' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Frank Doe/ });
    expect(within(row).getByText('Northside Clinic')).toBeInTheDocument();
  });

  it('falls back to a dash when the enrollment carries no facility', () => {
    render(
      <TrainingDetails course={baseCourse({ enrollments: [enrollment({ facility: null })] })} />,
    );

    const row = screen.getByRole('row', { name: /Frank Doe/ });
    expect(within(row).getAllByText('-').length).toBeGreaterThan(0);
  });
});

describe('TrainingDetails — stat cards', () => {
  // The design labels this card "Average Duration"; the value is the per-course
  // ESTIMATE, because nothing in the schema records time-on-task. Pinned so the
  // label and its source stay knowingly paired.
  it('labels the duration card "Average Duration" and renders course.duration', () => {
    render(<TrainingDetails course={baseCourse({ duration: 60 })} />);

    expect(screen.getByText('Average Duration')).toBeInTheDocument();
    expect(screen.getByText('60 mins')).toBeInTheDocument();
    expect(screen.queryByText('Estimated Duration')).not.toBeInTheDocument();
  });

  // Matches the neighbouring cards, which both render 0% on an empty course.
  it('renders "0 mins" rather than a blank or NaN when the course has no duration', () => {
    render(<TrainingDetails course={baseCourse({ duration: null })} />);

    expect(screen.getByText('0 mins')).toBeInTheDocument();
  });
});
