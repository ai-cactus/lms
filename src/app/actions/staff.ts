'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';

export async function getStaffDetails(userId: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        enrollments: {
          include: {
            course: {
              include: {
                lessons: {
                  include: { quiz: true },
                },
              },
            },
            quizAttempts: {
              orderBy: { completedAt: 'desc' },
              take: 1,
            },
          },
          orderBy: {
            startedAt: 'desc',
          },
        },
      },
    });

    if (!user) return null;

    // Calculate Stats
    const totalCourses = user.enrollments.length || 0;
    const completedCourses =
      user.enrollments.filter((e) => {
        const passingScore = e.course.lessons.find((l) => l.quiz)?.quiz?.passingScore || 70;
        return (
          e.status === 'completed' ||
          e.status === 'attested' ||
          (e.progress === 100 && (e.score || 0) >= passingScore)
        );
      }).length || 0;

    const failedCourses =
      user.enrollments.filter((e) => {
        const isFinished = e.status === 'completed' || e.progress === 100;
        const hasScore = e.score !== null;
        const passingScore = e.course.lessons.find((l) => l.quiz)?.quiz?.passingScore || 70;
        return isFinished && hasScore && (e.score || 0) < passingScore;
      }).length || 0;

    // Active courses are those in progress but NOT failed yet (or failed but we want to count them as active? usually specific bucket)
    // Let's say Active = Total - Completed - Failed
    // Due Soon logic: Enrollment currently does not have a dueDate field.
    // TODO: Add dueDate to Enrollment schema and include "Due Soon" (e.g. within 7 days) in this calculation.
    const activeCourses = Math.max(0, totalCourses - completedCourses - failedCourses);

    return {
      user: {
        id: user.id,
        name: user.profile?.fullName || user.email.split('@')[0],
        email: user.email,
        avatarUrl: user.profile?.avatarUrl ?? null,
        role: user.role || 'worker',
        jobTitle: user.profile?.jobTitle || 'Staff Member',
      },
      stats: {
        totalCourses,
        completedCourses,
        failedCourses,
        activeCourses,
      },
      enrollments: user.enrollments.map((e) => ({
        id: e.id,
        courseId: e.courseId,
        courseName: e.course.title,
        courseImage: e.course.thumbnail,
        status: e.status,
        progress: e.progress,
        score: e.score ?? 0,
        enrolledAt: e.startedAt,
        completedAt: e.completedAt,
        allowedAttempts: e.course.lessons.find((l) => l.quiz)?.quiz?.allowedAttempts ?? undefined,
        passingScore: e.course.lessons.find((l) => l.quiz)?.quiz?.passingScore || 70,
      })),
    };
  } catch (error) {
    console.error('Failed to fetch staff details:', error);
    return null;
  }
}

export async function updateStaffDetails(
  userId: string,
  data: {
    firstName: string;
    lastName: string;
    role: string;
    jobTitle: string;
  },
) {
  const session = await auth();
  // Verify admin/manager permissions - for now just check if logged in
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    // Update User role
    const user = await prisma.user.update({
      where: { id: userId },
      data: { role: data.role },
    });

    // Update Profile details
    // We use upsert to handle cases where users were created without a profile
    await prisma.profile.upsert({
      where: { id: userId },
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        fullName: `${data.firstName} ${data.lastName}`.trim(),
        jobTitle: data.jobTitle,
      },
      create: {
        id: userId,
        email: user.email,
        firstName: data.firstName,
        lastName: data.lastName,
        fullName: `${data.firstName} ${data.lastName}`.trim(),
        jobTitle: data.jobTitle,
      },
    });

    revalidatePath(`/dashboard/staff/${userId}`);
    revalidatePath('/dashboard/staff');
    return { success: true };
  } catch (error) {
    console.error('Failed to update staff details:', error);
    return { success: false, error: 'Failed to update user details' };
  }
}

export async function getEnrollmentQuizResult(enrollmentId: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        user: {
          include: {
            profile: true,
            organization: true,
          },
        },
        course: true,
        quizAttempts: {
          orderBy: { completedAt: 'desc' },
          take: 1,
          include: {
            quiz: {
              include: {
                questions: true,
              },
            },
          },
        },
      },
    });

    if (!enrollment || enrollment.quizAttempts.length === 0) {
      return null;
    }

    const latestAttempt = enrollment.quizAttempts[0];
    const quiz = latestAttempt.quiz;
    const userAnswers = Array.isArray(latestAttempt.answers)
      ? (latestAttempt.answers as {
          questionId: string;
          selectedAnswer: string;
          explanation?: string;
        }[])
      : [];

    const questions = quiz.questions.map((q) => {
      const userAnswerObj = userAnswers.find((a) => a.questionId === q.id);

      // Format options just like in the submit route: map text to A, B, C...
      const optionsArray = Array.isArray(q.options)
        ? (q.options as (string | { text: string })[])
        : [];
      const optionTexts = optionsArray.map((opt) =>
        typeof opt === 'string' ? opt : (opt as { text: string }).text || String(opt),
      );

      const formattedOptions = optionTexts.map((text, idx) => ({
        id: String.fromCharCode(65 + idx), // A, B, C...
        text: text,
      }));

      // Map selected answer (text) to ID (letter)
      const selectedText = userAnswerObj?.selectedAnswer || '';
      const selectedIdx = optionTexts.findIndex((t: string) => t === selectedText);
      const selectedAnswerId = selectedIdx >= 0 ? String.fromCharCode(65 + selectedIdx) : '';

      // Map correct answer (text) to ID (letter)
      const correctText = q.correctAnswer || '';
      const correctIdx = optionTexts.findIndex((t: string) => t === correctText);
      const correctAnswerId = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : '';

      return {
        id: q.id,
        text: q.text,
        options: formattedOptions,
        selectedAnswer: selectedAnswerId,
        correctAnswer: correctAnswerId,
        explanation: userAnswerObj?.explanation || '',
      };
    });

    const correctCount = questions.filter((q) => q.selectedAnswer === q.correctAnswer).length;
    const wrongCount = questions.length - correctCount;

    return {
      courseName: enrollment.course.title,
      score: latestAttempt.score,
      answered: questions.filter((q) => q.selectedAnswer).length,
      correct: correctCount,
      wrong: wrongCount,
      time: latestAttempt.timeTaken || 0,
      userName: enrollment.user.profile?.fullName || enrollment.user.email,
      organizationName: enrollment.user.organization?.name || undefined,
      questions: questions,
      attemptsUsed: latestAttempt.attemptCount,
      allowedAttempts: quiz.allowedAttempts,
      passingScore: quiz.passingScore,
    };
  } catch (error) {
    console.error('Failed to fetch quiz result:', error);
    return null;
  }
}

export async function removeStaff(userId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const admin = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, organizationId: true },
  });

  if (!admin || admin.role !== 'admin') {
    throw new Error('Insufficient permissions');
  }

  const staffUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, email: true },
  });

  if (!staffUser) {
    throw new Error('User not found');
  }

  if (staffUser.organizationId !== admin.organizationId) {
    throw new Error('User does not belong to your organization');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { organizationId: null },
  });

  revalidatePath('/dashboard/staff');
  return { success: true };
}
