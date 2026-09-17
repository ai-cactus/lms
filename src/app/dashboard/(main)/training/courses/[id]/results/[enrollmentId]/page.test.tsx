/**
 * The quiz-results page had no gate of its own: it called
 * `getEnrollmentWithResults` inside a try/catch and turned the data layer's
 * thrown `Access denied` into an in-page "Access Denied" card, and its
 * `Enrollment not found` into a separate "Not Found" card.
 *
 * Two problems, both fixed by founder ruling Q26
 * (docs/local/RBAC-founder-answers-2026-09-15.md). The card named the refusal,
 * and — because this URL carries an enrollment id — the two cards were
 * DISTINGUISHABLE: "Access Denied" confirmed the id exists and belongs to
 * someone, while "Not Found" said it does not. Both now collapse to `notFound()`.
 *
 * The page gate does NOT replace the data layer's checks. `getEnrollmentWithResults`
 * still owns authorship, tenancy, facility scope and the learner's own-attempt
 * exemption — every worker role holds `assessment.read` precisely so it can read
 * its own answer sheet, so this gate does not close that path. What the gate adds
 * is a refusal BEFORE the query for a role with no assessment remit at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockGetEnrollmentWithResults, mockRedirect, mockNotFound, mockLoggerError } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockGetEnrollmentWithResults: vi.fn(),
    mockRedirect: vi.fn((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    }),
    mockNotFound: vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
    }),
    mockLoggerError: vi.fn(),
  }));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect, notFound: mockNotFound }));
vi.mock('@/app/actions/enrollment', () => ({
  getEnrollmentWithResults: mockGetEnrollmentWithResults,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError, debug: vi.fn() },
  maskEmail: (email: string) => email,
}));
vi.mock('@/components/dashboard/training/QuizResults', () => ({
  default: () => <div data-testid="quiz-results" />,
}));

import QuizResultsPage from './page';

const COURSE_ID = 'course-1';
const ENROLLMENT_ID = 'enr-1';

function setSession(role: string) {
  mockAuth.mockResolvedValue({
    user: {
      id: 'user-1',
      // Required: evaluatePermission masks the email into its denial warning.
      email: 'gate@test.invalid',
      role,
      organizationId: 'org-1',
      organizationUserId: 'ou-1',
    },
  });
}

function renderPage() {
  return QuizResultsPage({
    params: Promise.resolve({ id: COURSE_ID, enrollmentId: ENROLLMENT_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setSession('hr');
  mockGetEnrollmentWithResults.mockResolvedValue({
    quizAttempts: [],
    course: { title: 'Bloodborne Pathogens', lessons: [] },
    organizationUser: {
      user: { fullName: 'Casey Worker', email: 'casey@acme.test' },
      organization: { name: 'Acme Clinic' },
    },
  });
});

describe('QuizResultsPage — assessment.read gate', () => {
  it('404s Finance before the enrollment is ever read', async () => {
    setSession('finance');

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockGetEnrollmentWithResults).not.toHaveBeenCalled();
  });

  it('redirects to /login when there is no session — not a 404', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockGetEnrollmentWithResults).not.toHaveBeenCalled();
  });

  it('admits a role holding assessment.read and renders the results', async () => {
    await expect(renderPage()).resolves.toBeDefined();
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockGetEnrollmentWithResults).toHaveBeenCalledWith(ENROLLMENT_ID);
  });
});

describe('QuizResultsPage — Q26 uniform deny on the data-layer refusal', () => {
  // The two must be INDISTINGUISHABLE: this URL carries an enrollment id, so a
  // distinct "Access Denied" told the caller the id exists and belongs to
  // someone they may not see.
  it.each(['Access denied', 'Enrollment not found'])('404s on a thrown %s', async (message) => {
    mockGetEnrollmentWithResults.mockRejectedValue(new Error(message));

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // An unexpected failure is not an authorization verdict — it keeps the
  // course-detail redirect so a transient DB error does not read as "this
  // enrollment does not exist".
  it('still redirects to the course detail on an unexpected failure', async () => {
    mockGetEnrollmentWithResults.mockRejectedValue(new Error('connection reset'));

    await expect(renderPage()).rejects.toThrow(
      `NEXT_REDIRECT:/dashboard/training/courses/${COURSE_ID}`,
    );
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalled();
  });
});
