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

/**
 * BUG-29: the manager's result sheet rendered a sentence manufactured from the
 * answer key ("The correct answer is B. …") in place of the stored explanation,
 * so the reviewer never saw the rationale the learner was shown. It now carries
 * the stored explanation and per-option rationale exactly as the learner's own
 * results view (`getLearnPayload`) resolves them.
 */
describe('QuizResultsPage — BUG-29 stored explanations', () => {
  type SheetQuestion = {
    explanation: string;
    correctAnswer: string;
    selectedAnswer: string;
    options: { id: string; text: string; explanation?: string }[];
  };

  function withAttempt(
    question: Record<string, unknown>,
    answer: Record<string, unknown> = { questionId: 'q-1', selectedAnswer: '3' },
  ) {
    mockGetEnrollmentWithResults.mockResolvedValue({
      quizAttempts: [{ score: 50, timeTaken: 120, answers: [answer], quiz: { passingScore: 70 } }],
      course: {
        title: 'Bloodborne Pathogens',
        lessons: [
          {
            quiz: {
              questions: [
                {
                  id: 'q-1',
                  text: '2 + 2 = ?',
                  options: ['3', '4', '5'],
                  correctAnswer: '4',
                  explanation: null,
                  incorrectOptionExplanations: null,
                  ...question,
                },
              ],
            },
          },
        ],
      },
      organizationUser: {
        user: { fullName: 'Casey Worker', email: 'casey@acme.test' },
        organization: { name: 'Acme Clinic' },
      },
    });
  }

  async function sheetQuestion(): Promise<SheetQuestion> {
    const element = (await renderPage()) as unknown as {
      props: { data: { questions: SheetQuestion[] } };
    };
    return element.props.data.questions[0];
  }

  it('renders the stored explanation, not a sentence built from the answer key', async () => {
    withAttempt({ explanation: 'Two pairs make four.' });

    const question = await sheetQuestion();

    expect(question.explanation).toBe('Two pairs make four.');
    expect(question.explanation).not.toContain('The correct answer is');
    expect(question.correctAnswer).toBe('B');
    expect(question.selectedAnswer).toBe('A');
  });

  it('carries the per-option rationale for the wrong options', async () => {
    withAttempt({
      explanation: 'Two pairs make four.',
      incorrectOptionExplanations: { '0': 'One short.', '2': 'One over.' },
    });

    const question = await sheetQuestion();

    expect(question.options).toEqual([
      { id: 'A', text: '3', explanation: 'One short.' },
      { id: 'B', text: '4', explanation: undefined },
      { id: 'C', text: '5', explanation: 'One over.' },
    ]);
  });

  // Same fallback the learner view uses: the attempt's answer row can carry
  // the explanation recorded when it was submitted.
  it('falls back to the explanation recorded on the attempt', async () => {
    withAttempt(
      { explanation: null },
      { questionId: 'q-1', selectedAnswer: '3', explanation: 'Recorded at submit.' },
    );

    expect((await sheetQuestion()).explanation).toBe('Recorded at submit.');
  });

  it('shows no explanation at all rather than inventing one', async () => {
    withAttempt({ explanation: null });

    expect((await sheetQuestion()).explanation).toBe('');
  });
});
