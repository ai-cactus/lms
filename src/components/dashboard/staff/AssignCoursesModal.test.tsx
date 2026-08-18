/**
 * Unit tests for src/components/dashboard/staff/AssignCoursesModal.tsx
 *
 * A three-step flow: select 1..N courses (tabbed Video/Reading, searchable,
 * already-enrolled courses shown disabled with a badge) → set an optional
 * shared deadline → success. The server assigns what it can and reports back
 * what was newly assigned / already assigned / failed; a submit that newly
 * assigns nothing must NOT advance past the deadline step, since that is what
 * makes "0 assigned ⇒ no email" legible to the admin.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CourseWithStats } from '@/types/course';

const { mockGetCourses, mockAssignCoursesToStaffMember } = vi.hoisted(() => ({
  mockGetCourses: vi.fn(),
  mockAssignCoursesToStaffMember: vi.fn(),
}));

vi.mock('@/app/actions/course', () => ({ getCourses: mockGetCourses }));
vi.mock('@/app/actions/staff', () => ({
  assignCoursesToStaffMember: mockAssignCoursesToStaffMember,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import AssignCoursesModal from './AssignCoursesModal';

function course(
  overrides: Partial<CourseWithStats> & { id: string; title: string },
): CourseWithStats {
  return {
    description: null,
    thumbnail: null,
    status: 'published',
    type: 'video',
    duration: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    lessonsCount: 1,
    enrollmentsCount: 0,
    completionRate: 0,
    ...overrides,
  };
}

const COURSES: CourseWithStats[] = [
  course({
    id: 'course-1',
    title: 'Safety Training',
    description: 'Fire drills and exits',
    type: 'video',
  }),
  course({ id: 'course-2', title: 'HIPAA Basics', description: 'Patient privacy', type: 'video' }),
  course({
    id: 'course-3',
    title: 'Infection Control',
    description: 'Handwashing 101',
    type: 'text',
  }),
];

function renderModal(overrides: Partial<React.ComponentProps<typeof AssignCoursesModal>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    staffUserId: 'staff-1',
    staffName: 'Jordan Rivera',
    enrolledCourseIds: [] as string[],
    onSuccess: vi.fn(),
    ...overrides,
  };
  return { ...render(<AssignCoursesModal {...props} />), props };
}

async function waitForCoursesLoaded() {
  await waitFor(() => expect(screen.queryByText(/loading courses/i)).not.toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCourses.mockResolvedValue(COURSES);
});

describe('AssignCoursesModal — course selection (select step)', () => {
  it('shows only Video courses on the default tab, and switches to Reading courses on that tab', async () => {
    renderModal();
    await waitForCoursesLoaded();

    expect(screen.getByText('Safety Training')).toBeInTheDocument();
    expect(screen.getByText('HIPAA Basics')).toBeInTheDocument();
    expect(screen.queryByText('Infection Control')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /reading courses/i }));

    expect(screen.getByText('Infection Control')).toBeInTheDocument();
    expect(screen.queryByText('Safety Training')).not.toBeInTheDocument();
  });

  it('filters the visible list by title and by description', async () => {
    renderModal();
    await waitForCoursesLoaded();

    const search = screen.getByPlaceholderText(/search video courses/i);

    await userEvent.type(search, 'HIPAA');
    expect(screen.getByText('HIPAA Basics')).toBeInTheDocument();
    expect(screen.queryByText('Safety Training')).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'fire drills');
    expect(screen.getByText('Safety Training')).toBeInTheDocument();
    expect(screen.queryByText('HIPAA Basics')).not.toBeInTheDocument();
  });

  it('renders an already-enrolled course as disabled with an "Assigned" badge, and it cannot be selected', async () => {
    renderModal({ enrolledCourseIds: ['course-1'] });
    await waitForCoursesLoaded();

    const checkbox = screen.getByRole('checkbox', { name: 'Safety Training' });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText('Assigned')).toBeInTheDocument();
  });

  it('button label reads "Assign Course" for one selection and "Assign N courses" for multiple', async () => {
    renderModal();
    await waitForCoursesLoaded();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Safety Training' }));
    expect(screen.getByRole('button', { name: 'Assign Course' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'HIPAA Basics' }));
    expect(screen.getByRole('button', { name: 'Assign 2 courses' })).toBeInTheDocument();
  });

  it('keeps the assign button disabled until at least one course is selected', async () => {
    renderModal();
    await waitForCoursesLoaded();

    expect(screen.getByRole('button', { name: 'Assign Course' })).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Safety Training' }));
    expect(screen.getByRole('button', { name: 'Assign Course' })).toBeEnabled();
  });
});

describe('AssignCoursesModal — deadline step and submission', () => {
  async function selectAndAdvance(...titles: string[]) {
    renderModal();
    await waitForCoursesLoaded();
    for (const title of titles) {
      await userEvent.click(screen.getByRole('checkbox', { name: title }));
    }
    await userEvent.click(screen.getByRole('button', { name: /assign/i }));
    expect(await screen.findByText('Set Completion Deadline')).toBeInTheDocument();
  }

  it('submits the selected course ids and a null dueAt when no deadline is chosen', async () => {
    mockAssignCoursesToStaffMember.mockResolvedValue({
      assigned: [{ courseId: 'course-1', courseTitle: 'Safety Training' }],
      alreadyAssigned: [],
      failed: [],
      invited: false,
      emailSent: true,
    });

    await selectAndAdvance('Safety Training');
    await userEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() =>
      expect(mockAssignCoursesToStaffMember).toHaveBeenCalledWith('staff-1', ['course-1'], {
        dueAt: null,
      }),
    );
  });

  it('submits every selected course id, in selection order', async () => {
    mockAssignCoursesToStaffMember.mockResolvedValue({
      assigned: [
        { courseId: 'course-1', courseTitle: 'Safety Training' },
        { courseId: 'course-2', courseTitle: 'HIPAA Basics' },
      ],
      alreadyAssigned: [],
      failed: [],
      invited: false,
      emailSent: true,
    });

    await selectAndAdvance('Safety Training', 'HIPAA Basics');
    await userEvent.click(screen.getByRole('button', { name: 'Assign 2 courses' }));

    await waitFor(() =>
      expect(mockAssignCoursesToStaffMember).toHaveBeenCalledWith(
        'staff-1',
        ['course-1', 'course-2'],
        { dueAt: null },
      ),
    );
  });

  it('advances to the success step and shows the assigned count when at least one course is newly assigned', async () => {
    mockAssignCoursesToStaffMember.mockResolvedValue({
      assigned: [{ courseId: 'course-1', courseTitle: 'Safety Training' }],
      alreadyAssigned: [],
      failed: [],
      invited: false,
      emailSent: true,
    });

    await selectAndAdvance('Safety Training');
    await userEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    expect(await screen.findByText('Courses Assigned Successfully')).toBeInTheDocument();
  });

  it('when nothing is newly assigned, stays on the deadline step and shows a warning instead of advancing to success', async () => {
    mockAssignCoursesToStaffMember.mockResolvedValue({
      assigned: [],
      alreadyAssigned: [{ courseId: 'course-1', courseTitle: 'Safety Training' }],
      failed: [],
      invited: false,
      emailSent: false,
    });

    await selectAndAdvance('Safety Training');
    await userEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() =>
      expect(screen.getByText('No new courses were assigned')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Courses Assigned Successfully')).not.toBeInTheDocument();
    // Still on the deadline step, not bounced back to select.
    expect(screen.getByText('Set Completion Deadline')).toBeInTheDocument();
  });

  it('names the failure reason ("could not be assigned") rather than the already-assigned copy when a course fails outright', async () => {
    mockAssignCoursesToStaffMember.mockResolvedValue({
      assigned: [],
      alreadyAssigned: [],
      failed: [{ courseId: 'course-1', courseTitle: 'Safety Training' }],
      invited: false,
      emailSent: false,
    });

    await selectAndAdvance('Safety Training');
    await userEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    await screen.findByText('No new courses were assigned');
    expect(screen.getByText(/could not be assigned/i)).toBeInTheDocument();
    expect(screen.queryByText(/already assigned/i)).not.toBeInTheDocument();
  });
});
