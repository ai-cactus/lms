import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await workerAuth();
    const adminSession = await adminAuth();

    if (!session?.user?.id && !adminSession?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const courseId = params.id;

    // Get course with lessons and quiz
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        lessons: {
          orderBy: { order: 'asc' },
          include: {
            quiz: {
              include: {
                questions: {
                  orderBy: { order: 'asc' },
                  select: {
                    id: true,
                    text: true,
                    type: true,
                    options: true,
                    // Note: NOT including correctAnswer here for security
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
        include: { quizAttempts: true },
      });
    }

    // If no enrollment found for worker, and admin session exists, check admin
    if (!enrollment && adminSession?.user?.id) {
      const adminEnroll = await prisma.enrollment.findFirst({
        where: { courseId: courseId, userId: adminSession.user.id },
        include: { quizAttempts: true },
      });
      if (adminEnroll || adminSession.user.role === 'admin') {
        activeUserId = adminSession.user.id;
        activeRole = adminSession.user.role;
        enrollment = adminEnroll;
      }
    }

    // Check if resolved user is admin
    const isAdmin = activeRole === 'admin';

    if (!enrollment && !isAdmin) {
      return NextResponse.json({ error: 'Not enrolled in this course' }, { status: 403 });
    }

    // Mock enrollment for admins if none exists
    const effectiveEnrollment = enrollment || {
      id: 'preview-mode',
      progress: 0,
      status: 'in_progress',
      score: null,
      quizAttempts: [],
    };

    // Extract quiz from last lesson (where it's attached)
    const lastLesson = course.lessons[course.lessons.length - 1];
    const quizData = lastLesson?.quiz as {
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
            options: Array.isArray(q.options) ? q.options : [],
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

    // Build detailed quiz results if the user has completed the quiz
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
              explanation: userAnswer?.explanation || '',
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
          duration: l.duration,
          order: l.order,
        })),
        quiz,
      },
      enrollment: {
        id: effectiveEnrollment.id,
        progress: effectiveEnrollment.progress,
        status: effectiveEnrollment.status,
        score: effectiveEnrollment.score,
        quizAttempts: effectiveEnrollment.quizAttempts,
      },
      quizResultsData,
      user: {
        name: user?.profile?.fullName || user?.email || '',
        role: user?.role || 'worker',
        organizationName: user?.organization?.name || undefined,
      },
    });
  } catch (error) {
    console.error('Error fetching course for learning:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
