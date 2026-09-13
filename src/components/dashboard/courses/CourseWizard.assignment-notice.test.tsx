/**
 * Assign-consolidation Phase 1 — the wizard-side advisory for a stale parked
 * deadline (see src/app/actions/course.ts `publishCourse` and
 * course.deferred-assignment.test.ts for the server-side replay behaviour).
 *
 * `publishCourse` now returns two INDEPENDENT advisory flags after a review-gate
 * replay: `assignmentFailed` (the replay could not run at all — genuine error)
 * and `assignmentDeadlineExpired` (the replay succeeded, but its parked deadline
 * had elapsed and was dropped in favour of each recipient's completion window —
 * not a failure). CourseWizard must render these in two visually and
 * semantically distinct ways: the error banner for the former, a warning
 * `Alert` (`role="alert"`) for the latter, never both from a single result.
 *
 * Every wizard step, and every modal CourseWizard opens, is stubbed so these
 * tests exercise only CourseWizard's own state machine (handlePublish /
 * handlePublishAnyway / wizardNotice / wizardError), mirroring the mocking
 * style AssignPublishClient.test.tsx uses for its own heavy dependencies.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GeneratedCourse } from '@/types/course';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { mockCreateFullCourse, mockPublishCourse } = vi.hoisted(() => ({
  mockCreateFullCourse: vi.fn(),
  mockPublishCourse: vi.fn(),
}));
vi.mock('@/app/actions/course', () => ({
  createFullCourse: mockCreateFullCourse,
  publishCourse: mockPublishCourse,
}));
vi.mock('@/app/actions/enrollment', () => ({ assignCourseToRoles: vi.fn() }));
vi.mock('@/app/actions/categories', () => ({ createCustomCategory: vi.fn() }));
vi.mock('@/app/actions/course-ai', () => ({
  analyzeStoredDocument: vi.fn().mockResolvedValue({
    error: null,
    title: '',
    description: '',
    objectives: [],
    duration: '',
    quizTitle: '',
  }),
}));
vi.mock('@/app/actions/documents', () => ({ getDocuments: vi.fn().mockResolvedValue([]) }));

// Every wizard step is a black box here — CourseWizard only needs to receive
// the field changes each step would normally collect from the admin.
vi.mock('./steps/Step1Category', () => ({
  __esModule: true,
  default: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button onClick={() => onSelect('cat-1')}>Pick Category</button>
  ),
}));
vi.mock('./steps/Step2Upload', () => ({
  __esModule: true,
  default: ({
    onDocumentChange,
  }: {
    onDocumentChange: (doc: {
      documentId: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    }) => void;
  }) => (
    <button
      onClick={() =>
        onDocumentChange({
          documentId: 'doc-1',
          fileName: 'f.pdf',
          fileSize: 10,
          mimeType: 'application/pdf',
        })
      }
    >
      Attach Document
    </button>
  ),
}));
vi.mock('./steps/Step3Details', () => ({
  __esModule: true,
  // Each field change is its own button so each click lands on a fresh render
  // — `onChange` replaces the whole formData object from a closure, so firing
  // several field changes inside one handler would silently drop all but the
  // last (the real steps only ever change one field per user interaction).
  default: ({ onChange }: { onChange: (field: string, val: unknown) => void }) => (
    <>
      <button onClick={() => onChange('title', 'Test Course')}>Set Title</button>
      <button onClick={() => onChange('description', 'A description')}>Set Description</button>
      <button onClick={() => onChange('objectives', ['a', 'b', 'c'])}>Set Objectives</button>
    </>
  ),
}));
vi.mock('./steps/Step4Quiz', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (field: string, val: unknown) => void }) => (
    <button onClick={() => onChange('quizTitle', 'Quiz')}>Set Quiz Title</button>
  ),
}));

const FAKE_GENERATED_CONTENT = {
  title: 'Test Course',
  description: 'A description',
  difficulty: 'moderate',
  duration: '30',
  objectives: ['a', 'b', 'c'],
  modules: [{ moduleIndex: 0, title: 'M1', lessons: [], quiz: [] }],
  quiz: [{ question: 'Q1', options: ['a', 'b'], answer: 0 }],
} as unknown as GeneratedCourse;

vi.mock('./steps/GenerationController', () => ({
  __esModule: true,
  default: ({ onComplete }: { onComplete: (content: GeneratedCourse) => void }) => (
    <button onClick={() => onComplete(FAKE_GENERATED_CONTENT)}>Complete Generation</button>
  ),
}));
vi.mock('./steps/Step6QuizReview', () => ({
  __esModule: true,
  default: () => <div>Quiz Review</div>,
}));
vi.mock('./steps/Step7Assign', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (field: string, val: unknown) => void }) => (
    <>
      <button onClick={() => onChange('assignMode', 'email')}>Assign By Email</button>
      <button onClick={() => onChange('assignments', ['worker@example.com'])}>
        Set Assignments
      </button>
    </>
  ),
  isAssignSelectionValid: (data: {
    assignMode: string;
    assignRoles: string[];
    assignments: string[];
  }) =>
    data.assignMode === 'roles' ? data.assignRoles.length > 0 : (data.assignments?.length ?? 0) > 0,
}));

vi.mock('./ConfirmPublishModal', () => ({
  __esModule: true,
  default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? <button onClick={onConfirm}>Confirm Publish</button> : null,
}));
vi.mock('./ReviewWarningsModal', () => ({
  __esModule: true,
  default: ({ isOpen, onPublishAnyway }: { isOpen: boolean; onPublishAnyway: () => void }) =>
    isOpen ? <button onClick={onPublishAnyway}>Publish Anyway</button> : null,
}));
vi.mock('./CourseSuccessModal', () => ({
  __esModule: true,
  default: () => <div>Success Modal</div>,
}));

import CourseWizard from './CourseWizard';

const ERROR_BANNER_TEXT = /assigning it to the selected recipients failed/i;
const NOTICE_TEXT = /completion deadline you set had already passed/i;

/** Fills every step's required fields and lands on the final "Assign" step. */
async function driveToFinalStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('Pick Category'));
  await user.click(screen.getByRole('button', { name: 'Next Step' }));

  await user.click(await screen.findByText('Attach Document'));
  await user.click(screen.getByRole('button', { name: 'Next Step' }));

  await user.click(await screen.findByText('Set Title'));
  await user.click(screen.getByText('Set Description'));
  await user.click(screen.getByText('Set Objectives'));
  await user.click(screen.getByRole('button', { name: 'Next Step' }));

  await user.click(await screen.findByText('Set Quiz Title'));
  await user.click(screen.getByRole('button', { name: 'Next Step' }));

  await user.click(await screen.findByText('Complete Generation'));
  await user.click(screen.getByRole('button', { name: 'Next Step' }));

  await user.click(await screen.findByRole('button', { name: 'Next Step' })); // quizReview

  await user.click(await screen.findByText('Assign By Email'));
  await user.click(screen.getByText('Set Assignments'));
}

/** Drives the wizard all the way to a review-gated publish + "Publish Anyway". */
async function publishIntoReviewGate(user: ReturnType<typeof userEvent.setup>) {
  mockCreateFullCourse.mockResolvedValueOnce({
    success: true,
    reviewRequired: true,
    courseId: 'draft-1',
    qualityWarnings: ['No slides were generated for this course.'],
  });

  await driveToFinalStep(user);
  await user.click(screen.getByRole('button', { name: 'Publish Course' }));
  await user.click(await screen.findByText('Confirm Publish'));
  await user.click(await screen.findByText('Publish Anyway'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateFullCourse.mockReset();
  mockPublishCourse.mockReset();
});

describe('CourseWizard — publish-review-gate replay advisory', () => {
  it('renders assignmentDeadlineExpired as a warning Alert, never as the error banner', async () => {
    const user = userEvent.setup();
    render(<CourseWizard />);

    mockPublishCourse.mockResolvedValue({
      id: 'draft-1',
      status: 'published',
      assignmentFailed: false,
      assignmentDeadlineExpired: true,
    });

    await publishIntoReviewGate(user);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(NOTICE_TEXT)).toBeInTheDocument();
    // A warning Alert, not the error-banner styling.
    expect(alert.className).toMatch(/warning/);
    expect(screen.queryByText(ERROR_BANNER_TEXT)).not.toBeInTheDocument();
  });

  it('renders a genuine assignmentFailed as the error banner, with no advisory at all', async () => {
    const user = userEvent.setup();
    render(<CourseWizard />);

    mockPublishCourse.mockResolvedValue({
      id: 'draft-1',
      status: 'published',
      assignmentFailed: true,
      assignmentDeadlineExpired: false,
    });

    await publishIntoReviewGate(user);

    expect(await screen.findByText(ERROR_BANNER_TEXT)).toBeInTheDocument();
    // No warning Alert rendered alongside the error — the two are mutually exclusive.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the advisory once the wizard advances to the next step', async () => {
    const user = userEvent.setup();
    render(<CourseWizard />);

    mockPublishCourse.mockResolvedValue({
      id: 'draft-1',
      status: 'published',
      assignmentFailed: false,
      assignmentDeadlineExpired: true,
    });

    await publishIntoReviewGate(user);
    await screen.findByRole('alert');

    // The success path already reset the wizard back to step 1 underneath the
    // (stubbed) success modal, so the category step's own control is what
    // drives the next advance.
    await user.click(await screen.findByText('Pick Category'));
    await user.click(screen.getByRole('button', { name: 'Next Step' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the advisory again on the reset that follows the next successful publish', async () => {
    const user = userEvent.setup();
    render(<CourseWizard />);

    mockPublishCourse.mockResolvedValue({
      id: 'draft-1',
      status: 'published',
      assignmentFailed: false,
      assignmentDeadlineExpired: true,
    });

    await publishIntoReviewGate(user);
    await screen.findByRole('alert');

    // A second, healthy course is created and published immediately (no review
    // gate) — `handlePublish`'s success branch resets `wizardNotice` alongside
    // every other piece of wizard state, independent of the step-advance path
    // exercised above.
    mockCreateFullCourse.mockResolvedValueOnce({
      success: true,
      reviewRequired: false,
      courseId: 'course-2',
      qualityWarnings: [],
    });
    await driveToFinalStep(user);
    await user.click(screen.getByRole('button', { name: 'Publish Course' }));
    await user.click(await screen.findByText('Confirm Publish'));

    await screen.findByText('Success Modal');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
