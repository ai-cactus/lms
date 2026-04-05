'use server';

import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { createNotification, notifyOrganizationAdmins } from './notifications';
import { QuizAttemptResult } from '@/types/quiz';

// Helper: resolve the active session from either auth instance
async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

/**
 * Get all available users (workers) that can be enrolled in courses.
 * Used by Share Modal to show selectable users.
 */
export async function getAvailableUsers() {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Get all users with worker role
  const users = await prisma.user.findMany({
    include: {
      profile: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    fullName: user.profile?.fullName || user.email,
    role: user.role || 'worker',
    avatarUrl: user.profile?.avatarUrl,
  }));
}

/**
 * Enroll users in a course by their email addresses.
 * Creates enrollment records for each valid email.
 * For emails not in the system, creates new user accounts and sends invite emails.
 */
export async function enrollUsers(courseId: string, emails: string[]) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Verify course exists and user owns it
  const course = await prisma.course.findUnique({
    where: { id: courseId },
  });

  if (!course || course.createdBy !== session.user.id) {
    throw new Error('Course not found');
  }

  // Get organization info for new user creation
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { organization: true },
  });

  const results = {
    success: [] as string[],
    alreadyEnrolled: [] as string[],
    newInvited: [] as string[],
    failed: [] as string[],
  };

  const bcrypt = await import('bcryptjs');
  const crypto = await import('crypto');
  const { sendCourseInviteEmail, sendCourseEnrollmentEmail } = await import('@/lib/email');

  for (const email of emails) {
    const normalizedEmail = email.toLowerCase().trim();

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      results.failed.push(email);
      continue;
    }

    // Find user by email
    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { profile: true },
    });

    // If user not found, create a new one with invite
    if (!user) {
      try {
        // Generate temporary password
        const tempPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        // Create new user
        const newUser = await prisma.user.create({
          data: {
            email: normalizedEmail,
            password: hashedPassword,
            role: 'worker',
            emailVerified: true,
            organizationId: currentUser?.organizationId || null,
          },
        });

        user = { ...newUser, profile: null };

        // Send invite email with credentials
        try {
          await sendCourseInviteEmail(
            normalizedEmail,
            tempPassword,
            course.title,
            currentUser?.organization?.name || 'Your Organization',
          );
          results.newInvited.push(email);
        } catch (emailErr) {
          console.error(`Failed to send invite email to ${email}:`, emailErr);
          results.newInvited.push(email);
        }
      } catch (createErr) {
        console.error(`Failed to create user for ${email}:`, createErr);
        results.failed.push(email);
        continue;
      }
    }

    if (!user) continue;

    // Check if already enrolled
    // Check both unique constraint and startedAt to handle re-enrollment logic if needed
    const existing = await prisma.enrollment.findFirst({
      where: {
        userId: user.id,
        courseId: courseId,
      },
    });

    if (existing) {
      if (!results.newInvited.includes(email)) {
        results.alreadyEnrolled.push(email);
      }
      continue;
    }

    // Create enrollment
    await prisma.enrollment.create({
      data: {
        userId: user.id,
        courseId: courseId,
        status: 'enrolled',
        progress: 0,
      },
    });

    // Notify the worker in-app
    await createNotification({
      userId: user.id,
      type: 'COURSE_ASSIGNED',
      title: 'New Course Assigned',
      message: `You have been assigned a new course: ${course.title}`,
      linkUrl: `/worker/trainings`,
      metadata: { courseId },
    });

    // Send enrollment notification only to existing users — new users already received
    // the invite email (with credentials) from sendCourseInviteEmail above.
    if (!results.newInvited.includes(email)) {
      try {
        await sendCourseEnrollmentEmail(
          normalizedEmail,
          user.profile?.fullName || 'there',
          course.title,
          currentUser?.organization?.name || 'Your Organization',
        );
      } catch (emailErr) {
        console.error(`Failed to send enrollment email to ${email}:`, emailErr);
      }
    }

    if (!results.newInvited.includes(email)) {
      results.success.push(email);
    }
  }

  revalidatePath(`/dashboard/training/courses/${courseId}`);
  return results;
}

/**
 * Get enrollment details with quiz results.
 */
export async function getEnrollmentWithResults(enrollmentId: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: {
        include: { profile: true, organization: true },
      },
      course: {
        include: {
          lessons: {
            include: {
              quiz: {
                include: {
                  questions: {
                    orderBy: { order: 'asc' },
                  },
                },
              },
            },
            orderBy: { order: 'asc' },
          },
        },
      },
      quizAttempts: {
        include: {
          quiz: {
            include: {
              questions: {
                orderBy: { order: 'asc' },
              },
            },
          },
        },
      },
    },
  });

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  const isEnrolledUser = enrollment.userId === session.user.id;
  const isCourseCreator = enrollment.course.createdBy === session.user.id;

  if (!isEnrolledUser && !isCourseCreator) {
    throw new Error('Access denied');
  }

  return enrollment;
}

/**
 * Submit a quiz attempt with answers.
 */
export async function submitQuizAttempt(
  enrollmentId: string,
  quizId: string,
  answers: { questionId: string; selectedAnswer: string }[],
  timeTaken?: number,
): Promise<QuizAttemptResult> {
  const [admin, worker] = await Promise.all([
    (await import('@/auth')).auth(),
    (await import('@/auth.worker')).auth(),
  ]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { course: true },
  });

  if (!enrollment || (enrollment.userId !== adminId && enrollment.userId !== workerId)) {
    throw new Error('Enrollment not found');
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { questions: true },
  });

  if (!quiz) {
    throw new Error('Quiz not found');
  }

  let correctCount = 0;
  for (const answer of answers) {
    const question = quiz.questions.find((q) => q.id === answer.questionId);
    if (question && question.correctAnswer === answer.selectedAnswer) {
      correctCount++;
    }
  }

  const totalQuestions = quiz.questions.length;
  const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const passed = score >= quiz.passingScore;

  const existingAttempt = await prisma.quizAttempt.findUnique({
    where: {
      enrollmentId_quizId: {
        enrollmentId,
        quizId,
      },
    },
  });

  if (existingAttempt) {
    await prisma.quizAttempt.update({
      where: { id: existingAttempt.id },
      data: {
        answers,
        score,
        timeTaken,
        completedAt: new Date(),
      },
    });
  } else {
    await prisma.quizAttempt.create({
      data: {
        enrollmentId,
        quizId,
        answers,
        score,
        timeTaken,
      },
    });
  }

  if (!passed) {
    const user = await prisma.user.findUnique({
      where: { id: enrollment.userId },
      include: { profile: true },
    });

    if (user && user.organizationId) {
      await notifyOrganizationAdmins(user.organizationId, {
        type: 'COURSE_FAILED',
        title: 'Quiz Failed',
        message: `${user.profile?.fullName || user.email} has failed the quiz for course: ${enrollment.course?.title || 'Unknown Course'}.`,
        linkUrl: `/dashboard/staff/${user.id}`,
        metadata: { userId: user.id, courseId: enrollment.courseId, score },
      });
    }
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'in_progress',
      score,
    },
  });

  revalidatePath(`/dashboard/training`);

  return {
    score,
    passed,
    correctCount,
    totalQuestions,
  };
}

/**
 * Worker requests a retry on a failed course quiz.
 */
export async function requestCourseRetry(enrollmentId: string) {
  const [admin, worker] = await Promise.all([
    (await import('@/auth')).auth(),
    (await import('@/auth.worker')).auth(),
  ]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: { include: { profile: true } },
      course: true,
    },
  });

  if (!enrollment || (enrollment.userId !== adminId && enrollment.userId !== workerId)) {
    throw new Error('Enrollment not found');
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'enrolled',
      score: null,
    },
  });

  if (enrollment.user.organizationId) {
    await notifyOrganizationAdmins(enrollment.user.organizationId, {
      type: 'COURSE_RETRY_REQUESTED',
      title: 'Course Retry Requested',
      message: `${enrollment.user.profile?.fullName || enrollment.user.email} has requested a retry for the course: ${enrollment.course.title}.`,
      linkUrl: `/dashboard/staff/${enrollment.user.id}`,
      metadata: { userId: enrollment.user.id, courseId: enrollment.courseId },
    });
  }

  revalidatePath(`/worker/trainings`);
  return { success: true };
}
