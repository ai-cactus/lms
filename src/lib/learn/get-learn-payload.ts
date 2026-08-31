import { isAdminRole, isWorkerRole } from '@/lib/rbac/role-utils';
import prisma from '@/lib/prisma';
import { getPortalSessions } from '@/lib/auth/portal-sessions';
import { logger } from '@/lib/logger';

const QUIZ_SELECT = {
  id: true,
  title: true,
  passingScore: true,
  allowedAttempts: true,
  timeLimit: true,
  questions: {
    orderBy: { order: 'asc' },
    // correctAnswer/explanation are fetched but only surfaced to admins
    // (the read-only answer-key review); never sent to workers.
    select: {
      id: true,
      text: true,
      type: true,
      options: true,
      correctAnswer: true,
      explanation: true,
    },
  },
} as const;

// The attempt fields the payload and the learn client actually read. `answers`
// stays — the client restores an in-progress attempt from it — but the rest of
// the row (quizId, enrollmentId) never leaves this handler.
const QUIZ_ATTEMPT_SELECT = {
  id: true,
  score: true,
  attemptCount: true,
  answers: true,
  timeTaken: true,
  completedAt: true,
} as const;

/** One saved quiz answer, as written by the quiz save/submit endpoints. */
export interface LearnPayloadAnswer {
  questionId: string;
  selectedAnswer: string;
  explanation?: string;
}

export interface LearnPayloadQuestion {
  id: string;
  text: string;
  type: string;
  options: string[];
  /** Answer key — present only for admin viewers (read-only review). */
  correctAnswer?: string;
  explanation?: string;
}

export interface LearnPayloadQuiz {
  id: string;
  title: string;
  passingScore: number;
  allowedAttempts: number | null;
  timeLimit: number | null;
  questions: LearnPayloadQuestion[];
}

export interface LearnPayloadLesson {
  id: string;
  title: string;
  content: string;
  slideContent: string | null;
  duration: number | null;
  order: number;
  videoProvider: string | null;
  videoStorageUri: string | null;
  videoDurationSeconds: number | null;
}

export interface LearnPayloadQuizAttempt {
  id: string;
  score: number;
  attemptCount: number;
  answers: LearnPayloadAnswer[];
  timeTaken: number | null;
  /** ISO 8601 — see `toIsoTimestamp` for why this is never a `Date`. */
  completedAt: string | null;
}

export interface LearnPayloadQuizResultQuestion {
  id: string;
  text: string;
  options: { id: string; text: string }[];
  selectedAnswer: string;
  correctAnswer: string;
  explanation: string;
}

export interface LearnPayloadQuizResults {
  score: number;
  passed: boolean;
  correctCount: number;
  totalQuestions: number;
  answered: number;
  correct: number;
  wrong: number;
  time: number;
  attemptsUsed: number;
  allowedAttempts: number | null;
  questions: LearnPayloadQuizResultQuestion[];
}

export interface LearnPayload {
  course: {
    id: string;
    title: string;
    description: string | null;
    duration: number | null;
    /**
     * How many `CourseModule` rows this course carries — the only input
     * `isWholeCourse` needs. Legacy single-document courses predate the module
     * builder and report 0.
     */
    moduleCount: number;
    lessons: LearnPayloadLesson[];
    quiz: LearnPayloadQuiz | null;
  };
  enrollment: {
    id: string;
    progress: number;
    status: string;
    score: number | null;
    videoPositionSeconds: number | null;
    quizAttempts: LearnPayloadQuizAttempt[];
  };
  quizResultsData: LearnPayloadQuizResults | null;
  /**
   * Whether THIS viewer is allowed to attest THIS enrollment — a worker-category
   * member of the organisation whose enrollment is not already attested.
   *
   * Deliberately attempt-independent. The pass verdict is never re-derived on
   * the client (that divergence is the bug): the caller ANDs this with the
   * server's own `passed` for the result on screen — `quizResultsData.passed` on
   * the reload path, the submit route's `passed` on the fresh-submit path — so
   * both paths reach the same answer from the same authority.
   */
  attestEligible: boolean;
  user: {
    name: string;
    /** The membership's real DB role, or null when the viewer has no membership. */
    role: string | null;
    /**
     * Whether to render the ADMIN review/editing experience. Derived from the
     * PORTAL, not the role — a manager who chose Learn carries an admin role on
     * the worker session by design (see session-bridge.ts), so the client must
     * not re-derive this with isAdminRole(). D-16 / team QA #1, #4, #5.
     */
    isAdminView: boolean;
    organizationName?: string;
    email: string;
    jobTitle: string;
  };
}

export interface LearnPayloadError {
  error: string;
  status: 401 | 403 | 404 | 500;
}

export function isLearnPayloadError(
  result: LearnPayload | LearnPayloadError,
): result is LearnPayloadError {
  return 'error' in result;
}

/**
 * Timestamps are normalised to ISO strings before they leave this module.
 *
 * The API route JSON-serialises the payload (Date → ISO string), but the learn
 * page hands the same payload straight across the RSC boundary, which preserves
 * `Date` instances. Without this, the two paths would seed the client with
 * different types for the same field.
 *
 * Tolerates a string because callers may already hold a serialised value.
 */
function toIsoTimestamp(value: Date | string | null): string | null {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Everything the learn experience needs for one course, for the caller's own
 * session. Returns a `LearnPayloadError` (never throws) so both consumers — the
 * API route and the server-rendered learn page — map the same outcomes onto
 * their own transport.
 */
export async function getLearnPayload(courseId: string): Promise<LearnPayload | LearnPayloadError> {
  try {
    const { admin: adminSession, worker: session } = await getPortalSessions();

    if (!session?.user?.id && !adminSession?.user?.id) {
      return { error: 'Unauthorized', status: 401 };
    }

    // Explicitly selected: an `include` would pull every Course scalar,
    // including the AI-pipeline artifacts (rawCourseJson, rawQuizJson,
    // rawSlidesJson, …) that this handler never reads.
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        description: true,
        duration: true,
        isGlobal: true,
        status: true,
        // A COUNT over the already-indexed course_modules.course_id, on a query
        // that is streaming every lesson body anyway — cheaper than the extra
        // round trip a separate query would cost.
        _count: { select: { modules: true } },
        creator: {
          select: { organizationId: true },
        },
        // Course-level quiz (video courses attach the quiz to the course, not a lesson).
        quiz: { select: QUIZ_SELECT },
        lessons: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            title: true,
            content: true,
            slideContent: true,
            duration: true,
            order: true,
            videoProvider: true,
            videoStorageUri: true,
            videoDurationSeconds: true,
            quiz: { select: QUIZ_SELECT },
          },
        },
      },
    });

    if (!course) {
      return { error: 'Course not found', status: 404 };
    }

    // Check both potential sessions for an enrollment to resolve cookie collision.
    // Enrollments hang off the ACTIVE membership, not the identity, so the
    // relevant id here is organizationUserId, not session.user.id.
    let activeOrganizationUserId = session?.user?.organizationUserId;
    let activeRole = session?.user?.role;
    let enrollment = null;

    if (activeOrganizationUserId) {
      enrollment = await prisma.enrollment.findFirst({
        where: { courseId: courseId, organizationUserId: activeOrganizationUserId },
        orderBy: { startedAt: 'desc' },
        include: {
          quizAttempts: { orderBy: { completedAt: 'desc' }, select: QUIZ_ATTEMPT_SELECT },
        },
      });
    }

    // If no enrollment found for worker, and admin session exists, check admin
    if (!enrollment && adminSession?.user?.id) {
      const adminOrganizationUserId = adminSession.user.organizationUserId;

      const adminEnroll = adminOrganizationUserId
        ? await prisma.enrollment.findFirst({
            where: { courseId: courseId, organizationUserId: adminOrganizationUserId },
            orderBy: { startedAt: 'desc' },
            include: {
              quizAttempts: { orderBy: { completedAt: 'desc' }, select: QUIZ_ATTEMPT_SELECT },
            },
          })
        : null;

      const isSameOrg = Boolean(
        adminSession.user.organizationId &&
        course.creator?.organizationId &&
        adminSession.user.organizationId === course.creator.organizationId,
      );

      // Global published courses are a shared catalog any org admin may open
      // (read-only review before assigning).
      const isGlobalCatalog = course.isGlobal && course.status === 'published';

      if (adminEnroll || (isAdminRole(adminSession.user.role) && (isSameOrg || isGlobalCatalog))) {
        activeOrganizationUserId = adminOrganizationUserId ?? activeOrganizationUserId;
        activeRole = adminSession.user.role;
        enrollment = adminEnroll;
      }
    }

    // Team QA #1/#4/#5 (D-16). `isAdminRole(activeRole)` was doing two unrelated
    // jobs: deciding whether the caller MAY OPEN this course, and deciding
    // whether to render the ADMIN editors. Those are different questions, and
    // conflating them is the whole of D-16.
    //
    // `enterLearnMode` mints a worker cookie that deliberately carries the
    // admin's real role (see session-bridge.ts — the worker instance tolerates
    // it because sessionAllowedRoles is ALL_ROLES). So a manager who switched to
    // Learn had an admin role on the WORKER session, `isAdmin` came out true,
    // and LearnClient rendered AdminLessonEditor / AdminQuizEditor instead of
    // the learner UI. That single fact explains all three reports:
    //   #1 the admin course view, #4 the quiz that never submits (the admin quiz
    //   panel has no submit control) and #5 the "module-scoped" slide picker
    //   (CourseRail already renders every lesson flat — what they saw was the
    //   editor).
    //
    // ACCESS still keys on the role: an admin may open a same-org or global
    // course with no enrollment, which is what the fallback above grants.
    const mayOpenWithoutEnrollment = isAdminRole(activeRole);

    if (!enrollment && !mayOpenWithoutEnrollment) {
      return { error: 'Not enrolled in this course', status: 403 };
    }

    // VIEW MODE keys on the PORTAL. A worker session exists only because the
    // caller is in the worker portal — either a real worker, or a manager who
    // deliberately chose Learn. Either way they asked for the learner
    // experience. An admin opening /learn from the dashboard has no worker
    // cookie and keeps the review/editing view unchanged.
    const inLearnerPortal = Boolean(session?.user?.id);
    const isAdmin = mayOpenWithoutEnrollment && !inLearnerPortal;

    // `answers` is a Prisma `Json` column the quiz endpoints always write as an
    // answer array; the client still guards with Array.isArray before reading it.
    const quizAttempts: LearnPayloadQuizAttempt[] = (enrollment?.quizAttempts ?? []).map(
      (attempt) => ({
        ...attempt,
        answers: attempt.answers as unknown as LearnPayloadAnswer[],
        completedAt: toIsoTimestamp(attempt.completedAt),
      }),
    );

    // Mock enrollment for admins if none exists
    const effectiveEnrollment = enrollment || {
      id: 'preview-mode',
      progress: 0,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: null,
    };

    // Quiz lives on the last lesson (text courses) or on the course itself
    // (video courses). Prefer the lesson quiz, fall back to the course quiz.
    const lastLesson = course.lessons[course.lessons.length - 1];
    const quizData = lastLesson?.quiz ?? course.quiz;

    const quiz: LearnPayloadQuiz | null = quizData
      ? {
          id: quizData.id,
          title: quizData.title,
          passingScore: quizData.passingScore,
          allowedAttempts: quizData.allowedAttempts,
          timeLimit: quizData.timeLimit,
          questions: quizData.questions.map((q) => ({
            id: q.id,
            text: q.text,
            type: q.type,
            options: Array.isArray(q.options) ? ([...q.options] as string[]) : [],
            // Answer key is exposed only to admins (read-only review).
            ...(isAdmin
              ? { correctAnswer: q.correctAnswer ?? '', explanation: q.explanation ?? '' }
              : {}),
          })),
        }
      : null;

    // Get membership details for attestation
    const activeMembership = activeOrganizationUserId
      ? await prisma.organizationUser.findUnique({
          where: { id: activeOrganizationUserId },
          // Explicitly selected: `include: { user: true }` drags the bcrypt
          // password hash into a handler that only needs a display name.
          select: {
            role: true,
            jobTitle: true,
            user: { select: { fullName: true, email: true } },
            organization: { select: { name: true } },
          },
        })
      : null;

    let quizResultsData: LearnPayloadQuizResults | null = null;

    // Sorted in place: `quizAttempts` is the array returned in the payload, so
    // the client receives newest-completed-first, as it always has.
    const latestAttempt =
      quizAttempts.length > 0
        ? quizAttempts.sort((a, b) => {
            const dateB = new Date(b.completedAt || 0).getTime();
            const dateA = new Date(a.completedAt || 0).getTime();
            return dateB - dateA;
          })[0]
        : null;

    if (latestAttempt && quizData) {
      // The main course query already loaded this quiz's questions WITH their
      // correct answers (the answer key is filtered out later, when building the
      // client-facing `quiz`), so re-reading them here would be a redundant round
      // trip for identical rows.
      const questions = quizData.questions;
      const attemptAnswers = Array.isArray(latestAttempt.answers) ? latestAttempt.answers : [];
      const totalQ = questions.length;
      const correctCount = attemptAnswers.filter((a) => {
        const question = questions.find((q) => q.id === a.questionId);
        return question && question.correctAnswer === a.selectedAnswer;
      }).length;

      quizResultsData = {
        score: latestAttempt.score || 0,
        passed: (latestAttempt.score || 0) >= (quizData.passingScore || 70),
        correctCount,
        totalQuestions: totalQ,
        answered: attemptAnswers.length,
        correct: correctCount,
        wrong: attemptAnswers.length - correctCount,
        time: latestAttempt.timeTaken || 0,
        attemptsUsed: latestAttempt.attemptCount || 1,
        allowedAttempts: quizData.allowedAttempts,
        questions: questions.map((q) => {
          const userAnswer = attemptAnswers.find((a) => a.questionId === q.id);
          const optionsArray = Array.isArray(q.options)
            ? (q.options as (string | { text: string })[])
            : [];
          const optionTexts = optionsArray.map((opt) =>
            typeof opt === 'string' ? opt : opt.text || (opt as { text?: string }).toString(),
          );

          const selectedText = userAnswer?.selectedAnswer || '';
          const selectedIdx = optionTexts.findIndex((t: string) => t === selectedText);
          const selectedLetter = selectedIdx >= 0 ? String.fromCharCode(65 + selectedIdx) : '';

          const correctText = q.correctAnswer || '';
          const correctIdx = optionTexts.findIndex((t: string) => t === correctText);
          const correctLetter = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : '';

          return {
            id: q.id,
            text: q.text,
            options: optionsArray.map((opt, idx: number) => ({
              id: String.fromCharCode(65 + idx),
              text:
                typeof opt === 'string'
                  ? opt
                  : (opt as { text?: string }).text || (opt as { text?: string }).toString(),
            })),
            selectedAnswer: selectedLetter,
            correctAnswer: correctLetter,
            explanation: q.explanation || userAnswer?.explanation || '',
          };
        }),
      };
    }

    // ONE server-side verdict for the attestation gate. The learn client used to
    // re-derive the viewer's worker-ness from a payload role that fell back to
    // the literal 'worker' — a value that is NOT in WORKER_ROLES — so whenever
    // the membership lookup came back null the Attest button silently vanished
    // and the learner was left with "Done" as the only option.
    const attestEligible =
      isWorkerRole(activeMembership?.role) && effectiveEnrollment.status !== 'attested';

    return {
      course: {
        id: course.id,
        title: course.title,
        description: course.description,
        duration: course.duration,
        moduleCount: course._count.modules,
        lessons: course.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          content: l.content,
          slideContent: l.slideContent,
          duration: l.duration,
          order: l.order,
          videoProvider: l.videoProvider,
          videoStorageUri: l.videoStorageUri,
          videoDurationSeconds: l.videoDurationSeconds,
        })),
        quiz,
      },
      enrollment: {
        id: effectiveEnrollment.id,
        progress: effectiveEnrollment.progress,
        status: effectiveEnrollment.status,
        score: effectiveEnrollment.score,
        videoPositionSeconds: effectiveEnrollment.videoPositionSeconds,
        quizAttempts,
      },
      quizResultsData,
      attestEligible,
      user: {
        name: activeMembership?.user.fullName || activeMembership?.user.email || '',
        role: activeMembership?.role ?? null,
        isAdminView: isAdmin,
        organizationName: activeMembership?.organization.name || undefined,
        email: activeMembership?.user.email || '',
        jobTitle: activeMembership?.jobTitle || '',
      },
    };
  } catch (error) {
    logger.error({ msg: 'Error fetching course for learning:', err: error });
    return { error: 'Internal server error', status: 500 };
  }
}
