/**
 * Unit tests for the staff-profile "Assign Course" flow (design: Assign Courses
 * → Set Completion Deadline → Courses Assigned Successfully).
 *
 * Covers the behaviour the frames pin down: the Video / Reading tabs partition
 * the org catalog by course type and re-label the search box, the selection
 * count drives both the pill and the CTA label, a suggested-deadline chip fills
 * the date field, and the confirmation reports the count the SERVER returned
 * (newly created enrollments) rather than the number of rows ticked.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AssignCoursesModal from './AssignCoursesModal';

const { mockGetCourses, mockAssignCoursesToUser, mockRefresh } = vi.hoisted(() => ({
  mockGetCourses: vi.fn(),
  mockAssignCoursesToUser: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('@/app/actions/course', () => ({
  getCourses: mockGetCourses,
  assignCoursesToUser: mockAssignCoursesToUser,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeCourse(overrides: Record<string, unknown>) {
  return {
    id: 'course-1',
    title: 'HIPAA Privacy Training',
    description: 'Comprehensive training on workplace hazards.',
    thumbnail: null,
    status: 'published',
    type: 'video',
    duration: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lessonsCount: 1,
    enrollmentsCount: 0,
    sourceDocumentId: null,
    completionRate: 0,
    ...overrides,
  };
}

const COURSES = [
  makeCourse({ id: 'vid-1', title: 'Workplace Safety', type: 'video' }),
  makeCourse({ id: 'vid-2', title: 'Fire Drill Basics', type: 'video' }),
  makeCourse({ id: 'read-1', title: 'Data Security Awareness', type: 'text' }),
  makeCourse({ id: 'read-2', title: 'Patient Rights and Consent', type: 'text' }),
];

function renderModal(onClose = vi.fn()) {
  render(
    <AssignCoursesModal isOpen onClose={onClose} staffOrgUserId="ou-1" staffName="Frank Doe" />,
  );
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCourses.mockResolvedValue(COURSES);
  mockAssignCoursesToUser.mockResolvedValue({ assigned: 1, alreadyAssigned: 0, failed: 0 });
});

describe('AssignCoursesModal — course selection', () => {
  it('opens on the Video tab and lists only video courses', async () => {
    renderModal();

    expect(await screen.findByRole('checkbox', { name: 'Workplace Safety' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Fire Drill Basics' })).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Data Security Awareness' }),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search video courses…')).toBeInTheDocument();
  });

  it('switches the list and the search placeholder on the Reading tab', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole('checkbox', { name: 'Workplace Safety' });

    await user.click(screen.getByRole('tab', { name: 'Reading Courses' }));

    expect(
      await screen.findByRole('checkbox', { name: 'Data Security Awareness' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Workplace Safety' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search reading courses…')).toBeInTheDocument();
  });

  it('filters the list by title as the admin types', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole('checkbox', { name: 'Workplace Safety' });

    await user.type(screen.getByPlaceholderText('Search video courses…'), 'fire');

    expect(screen.getByRole('checkbox', { name: 'Fire Drill Basics' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Workplace Safety' })).not.toBeInTheDocument();
  });

  it('shows the selected-count pill and pluralises the CTA once past one course', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole('checkbox', { name: 'Workplace Safety' });

    const cta = screen.getByRole('button', { name: 'Assign Course' });
    expect(cta).toBeDisabled();
    expect(screen.queryByText(/\d+ selected/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Workplace Safety' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Course' })).toBeEnabled();

    await user.click(screen.getByRole('checkbox', { name: 'Fire Drill Basics' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign 2 courses' })).toBeInTheDocument();
  });

  it('keeps selections made on one tab when the admin switches to the other', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole('checkbox', { name: 'Workplace Safety' });

    await user.click(screen.getByRole('checkbox', { name: 'Workplace Safety' }));
    await user.click(screen.getByRole('tab', { name: 'Reading Courses' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Data Security Awareness' }));

    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });
});

describe('AssignCoursesModal — deadline step', () => {
  async function advanceToDeadline(user: ReturnType<typeof userEvent.setup>) {
    renderModal();
    await screen.findByRole('checkbox', { name: 'Workplace Safety' });
    await user.click(screen.getByRole('checkbox', { name: 'Workplace Safety' }));
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));
    await screen.findByText('Set Completion Deadline');
  }

  it('sets the due date from a suggested chip', async () => {
    const user = userEvent.setup();
    await advanceToDeadline(user);

    const trigger = screen.getByRole('button', { name: 'Completion deadline' });
    expect(trigger).toHaveTextContent('Select due date');

    await user.click(screen.getByRole('button', { name: '30 days' }));

    const expected = new Date();
    expected.setDate(expected.getDate() + 30);
    expect(trigger).toHaveTextContent(String(expected.getFullYear()));
    expect(trigger).not.toHaveTextContent('Select due date');
  });

  it('assigns without a deadline and shows the count the server reported', async () => {
    const user = userEvent.setup();
    mockAssignCoursesToUser.mockResolvedValue({ assigned: 3, alreadyAssigned: 1, failed: 0 });
    await advanceToDeadline(user);

    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    expect(await screen.findByText('Courses Assigned Successfully')).toBeInTheDocument();
    expect(mockAssignCoursesToUser).toHaveBeenCalledWith('ou-1', ['vid-1'], null);
    expect(screen.getByText(/have been assigned to 3 courses/)).toBeInTheDocument();
    expect(screen.getByText('“Frank Doe”')).toBeInTheDocument();
  });

  it('surfaces the server error and stays on the deadline step when nothing was assigned', async () => {
    const user = userEvent.setup();
    mockAssignCoursesToUser.mockResolvedValue({
      assigned: 0,
      alreadyAssigned: 0,
      failed: 1,
      error: 'Your organization needs an active subscription to assign courses.',
    });
    await advanceToDeadline(user);

    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    expect(
      await screen.findByText('Your organization needs an active subscription to assign courses.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Courses Assigned Successfully')).not.toBeInTheDocument();
  });

  it('reports an already-assigned batch instead of claiming zero courses were assigned', async () => {
    const user = userEvent.setup();
    mockAssignCoursesToUser.mockResolvedValue({ assigned: 0, alreadyAssigned: 1, failed: 0 });
    await advanceToDeadline(user);

    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    expect(
      await screen.findByText('Frank Doe is already assigned to the selected course.'),
    ).toBeInTheDocument();
  });
});

describe('AssignCoursesModal — success step', () => {
  it('closes and refreshes the profile on Done', async () => {
    const user = userEvent.setup();
    const onClose = renderModal();
    await screen.findByRole('checkbox', { name: 'Workplace Safety' });
    await user.click(screen.getByRole('checkbox', { name: 'Workplace Safety' }));
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));
    await user.click(await screen.findByRole('button', { name: 'Assign Course' }));

    await user.click(await screen.findByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });
});
