import { NextRequest, NextResponse } from 'next/server';
import { isAdminRole } from '@/lib/rbac/role-utils';
import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await workerAuth();
    const adminSession = await adminAuth();

    if (!session?.user?.id && !adminSession?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const courseId = params.id;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        creator: {
          select: { organizationId: true },
        },
        // Course-level quiz (video courses attach the quiz to the course, not a lesson).
        quiz: {
          include: { questions: { orderBy: { order: 'asc' } } },
        },
        lessons: {
          orderBy: { order: 'asc' },
          include: {
            quiz: {
              include: {
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
              },
            },
          },
        },
      },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Check both potential user IDs for an enrollment to resolve cookie collision
    let activeUserId = session?.user?.id;
    let activeRole = session?.user?.role;
    let enrollment = null;

    if (activeUserId) {
      enrollment = await prisma.enrollment.findFirst({
        where: { courseId: courseId, userId: activeUserId },
        orderBy: { startedAt: 'desc' },
        include: { quizAttempts: true },
      });
    }

    // If no enrollment found for worker, and admin session exists, check admin
    if (!enrollment && adminSession?.user?.id) {
      const adminUser = await prisma.user.findUnique({
        where: { id: adminSession.user.id },
        select: { id: true, role: true, organizationId: true },
      });

      const adminEnroll = await prisma.enrollment.findFirst({
        where: { courseId: courseId, userId: adminSession.user.id },
        orderBy: { startedAt: 'desc' },
        include: { quizAttempts: true },
      });

      const isSameOrg = Boolean(
        adminUser?.organizationId &&
        course.creator?.organizationId &&
        adminUser.organizationId === course.creator.organizationId,
      );

      // Global published courses are a shared catalog any org admin may open
      // (read-only review before assigning).
      const isGlobalCatalog = course.isGlobal && course.status === 'published';

      if (adminEnroll || (isAdminRole(adminUser?.role) && (isSameOrg || isGlobalCatalog))) {
        activeUserId = adminSession.user.id;
        // Cast the role to 'admin' | 'worker' | undefined based on session type if necessary
        // Or cast as `any` or exactly `typeof session.user.role`
        activeRole = (adminUser?.role as typeof activeRole) || adminSession.user.role;
        enrollment = adminEnroll;
      }
    }

    const isAdmin = isAdminRole(activeRole);

    if (!enrollment && !isAdmin) {
      return NextResponse.json({ error: 'Not enrolled in this course' }, { status: 403 });
    }

    // Mock enrollment for admins if none exists
    const effectiveEnrollment = enrollment || {
      id: 'preview-mode',
      progress: 0,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: null,
      quizAttempts: [],
    };

    // Quiz lives on the last lesson (text courses) or on the course itself
    // (video courses). Prefer the lesson quiz, fall back to the course quiz.
    const lastLesson = course.lessons[course.lessons.length - 1];
    const quizData = (lastLesson?.quiz ?? course.quiz) as {
      id: string;
      title: string;
      passingScore: number;
      allowedAttempts: number | null;
      timeLimit: number | null;
      questions: {
        id: string;
        text: string;
        type: string;
        options: unknown;
        correctAnswer?: string;
        explanation?: string | null;
      }[];
    } | null;

    const quiz = quizData
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
            options: Array.isArray(q.options) ? [...q.options] : [],
            // Answer key is exposed only to admins (read-only review).
            ...(isAdmin
              ? { correctAnswer: q.correctAnswer ?? '', explanation: q.explanation ?? '' }
              : {}),
          })),
        }
      : null;

    // Get user details for attestation
    const user = activeUserId
      ? await prisma.user.findUnique({
          where: { id: activeUserId },
          include: { profile: true, organization: true },
        })
      : null;

    let quizResultsData = null;
    const quizAttempts =
      (effectiveEnrollment.quizAttempts as
        | {
            completedAt?: string | Date;
            createdAt?: string | Date;
            answers?: { questionId: string; selectedAnswer: string; explanation?: string }[];
            score?: number;
            timeTaken?: number | null;
          }[]
        | undefined) || [];

    const latestAttempt =
      quizAttempts.length > 0
        ? quizAttempts.sort((a, b) => {
            const dateB = new Date(b.completedAt || b.createdAt || 0).getTime();
            const dateA = new Date(a.completedAt || a.createdAt || 0).getTime();
            return dateB - dateA;
          })[0]
        : null;

    if (latestAttempt && quizData) {
      // Fetch quiz with correct answers for results
      const quizWithAnswers = await prisma.quiz.findUnique({
        where: { id: quizData.id },
        include: { questions: { orderBy: { order: 'asc' } } },
      });

      if (quizWithAnswers) {
        const attemptAnswers = Array.isArray(latestAttempt.answers)
          ? (latestAttempt.answers as {
              questionId: string;
              selectedAnswer: string;
              explanation?: string;
            }[])
          : [];
        const totalQ = quizWithAnswers.questions.length;
        const correctCount = attemptAnswers.filter((a) => {
          const question = quizWithAnswers.questions.find((q) => q.id === a.questionId);
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
          attemptsUsed: (latestAttempt as { attemptCount?: number }).attemptCount || 1,
          allowedAttempts: quizData.allowedAttempts,
          questions: quizWithAnswers.questions.map((q) => {
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
    }

    return NextResponse.json({
      course: {
        id: course.id,
        title: course.title,
        description: course.description,
        duration: course.duration,
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
        quizAttempts: effectiveEnrollment.quizAttempts,
      },
      quizResultsData,
      user: {
        name: user?.profile?.fullName || user?.email || '',
        role: user?.role || 'worker',
        organizationName: user?.organization?.name || undefined,
        email: user?.email || '',
        jobTitle: user?.profile?.jobTitle || '',
      },
    });
  } catch (error) {
    logger.error({ msg: 'Error fetching course for learning:', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
