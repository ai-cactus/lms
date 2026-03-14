'use server';

import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { notifyOrganizationAdmins } from './notifications';
import { CourseWithStats, CourseWithRelations } from '@/types/course';
import { QuizQuestion } from '@/types/quiz';

// Helper: resolve the active session from either auth instance
async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

// KursWithStats is now imported from '@/types/course'

// Get all courses for current user (admin)
export async function getCourses(): Promise<CourseWithStats[]> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const courses = await prisma.course.findMany({
    where: { createdBy: session.user.id },
    include: {
      lessons: { select: { id: true } },
      enrollments: { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return courses.map((course) => ({
    id: course.id,
    title: course.title,
    description: course.description,
    thumbnail: course.thumbnail,
    status: course.status,
    category: course.category,
    duration: course.duration,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    lessonsCount: course.lessons.length,
    enrollmentsCount: course.enrollments.length,
    completionRate:
      course.enrollments.length > 0
        ? Math.round(
            (course.enrollments.filter((e) => e.status === 'completed' || e.status === 'attested')
              .length /
              course.enrollments.length) *
              100,
          )
        : 0,
  }));
}

// Get single course by ID with lessons
export async function getCourseById(courseId: string): Promise<CourseWithRelations> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      lessons: {
        orderBy: { order: 'asc' },
        include: {
          quiz: {
            include: { questions: { orderBy: { order: 'asc' } } },
          },
        },
      },
      enrollments: {
        include: { user: { include: { profile: true } } },
      },
      creator: {
        include: { profile: true },
      },
    },
  });

  if (!course) {
    throw new Error('Course not found');
  }

  // Allow access if user is the creator OR is enrolled in the course
  const isCreator = course.createdBy === session.user.id;
  const isEnrolled = course.enrollments.some((e) => e.userId === session.user.id);

  if (!isCreator && !isEnrolled) {
    throw new Error('Course not found');
  }

  return course;
}

// Create a new course
export async function createCourse(data: {
  title: string;
  description?: string;
  category?: string;
}) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const course = await prisma.course.create({
    data: {
      title: data.title,
      description: data.description || null,
      category: data.category || null,
      createdBy: session.user.id,
    },
  });

  revalidatePath('/dashboard/training');
  return course;
}

// Update course details
export async function updateCourse(
  courseId: string,
  data: {
    title?: string;
    description?: string;
    thumbnail?: string;
    category?: string;
    duration?: number;
  },
) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Verify ownership
  const existing = await prisma.course.findUnique({ where: { id: courseId } });
  if (!existing || existing.createdBy !== session.user.id) {
    throw new Error('Course not found');
  }

  const course = await prisma.course.update({
    where: { id: courseId },
    data,
  });

  revalidatePath('/dashboard/training');
  revalidatePath(`/dashboard/training/${courseId}`);
  return course;
}

// Publish a course
export async function publishCourse(courseId: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const existing = await prisma.course.findUnique({ where: { id: courseId } });
  if (!existing || existing.createdBy !== session.user.id) {
    throw new Error('Course not found');
  }

  const course = await prisma.course.update({
    where: { id: courseId },
    data: { status: 'published' },
  });

  revalidatePath('/dashboard/training');
  return course;
}

// Delete a course
export async function deleteCourse(courseId: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const existing = await prisma.course.findUnique({ where: { id: courseId } });
  if (!existing || existing.createdBy !== session.user.id) {
    throw new Error('Course not found');
  }

  await prisma.course.delete({ where: { id: courseId } });

  revalidatePath('/dashboard/training');
  return { success: true };
}

// Get dashboard statistics
export async function getDashboardStats() {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const [courses, enrollments] = await Promise.all([
    prisma.course.findMany({
      where: { createdBy: session.user.id },
      include: {
        enrollments: true,
        lessons: {
          include: { quiz: true },
        },
      },
    }),
    prisma.enrollment.findMany({
      where: { course: { createdBy: session.user.id } },
    }),
  ]);

  const totalCourses = courses.length;
  const totalStaffAssigned = new Set(enrollments.map((e) => e.userId)).size;
  const enrollmentsWithScore = enrollments.filter((e) => e.score !== null);
  const averageScore =
    enrollmentsWithScore.length > 0
      ? Math.round(
          enrollmentsWithScore.reduce((sum, e) => sum + (e.score || 0), 0) /
            enrollmentsWithScore.length,
        )
      : 0;

  // Calculate monthly performance (average score per month for last 12 months)
  const monthlyPerformance = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (11 - i));
    return {
      month: d.toLocaleString('default', { month: 'short' }),
      monthIdx: d.getMonth(),
      year: d.getFullYear(),
    };
  }).map(({ month, monthIdx, year }) => {
    const inMonth = completedEnrollments.filter((e) => {
      if (!e.completedAt) return false;
      const c = new Date(e.completedAt);
      return c.getMonth() === monthIdx && c.getFullYear() === year;
    });

    const avg =
      inMonth.length > 0
        ? Math.round(inMonth.reduce((sum, e) => sum + (e.score || 0), 0) / inMonth.length)
        : 0;

    return { month, value: avg };
  });

  // Calculate Course Performance (Scores vs Courses)
  const coursePerformance = courses.map((course) => {
    // Find passing score
    const quiz = course.lessons.find((l) => l.quiz)?.quiz;
    const passingScore = quiz?.passingScore || 70;

    // Filter valid enrollments with scores
    const validEnrollments = course.enrollments.filter((e) => e.score !== null);

    const passCount = validEnrollments.filter((e) => (e.score || 0) >= passingScore).length;
    const failCount = validEnrollments.filter((e) => (e.score || 0) < passingScore).length;

    const avgScore =
      validEnrollments.length > 0
        ? Math.round(
            validEnrollments.reduce((sum, e) => sum + (e.score || 0), 0) / validEnrollments.length,
          )
        : 0;

    return {
      name: course.title,
      score: avgScore,
      passingScore,
      passCount,
      failCount,
    };
  });

  const completedCount = enrollments.filter(
    (e) => e.status === 'completed' || e.status === 'attested',
  ).length;
  const inProgressCount = enrollments.filter((e) => e.status === 'in_progress').length;
  const enrolledCount = enrollments.filter((e) => e.status === 'enrolled').length;
  const totalEnrollments = enrollments.length;

  return {
    totalCourses,
    totalStaffAssigned,
    averageGrade: averageScore,
    monthlyPerformance,
    coursePerformance, // New Field
    trainingCoverage: {
      completed: totalEnrollments > 0 ? Math.round((completedCount / totalEnrollments) * 100) : 0,
      inProgress: totalEnrollments > 0 ? Math.round((inProgressCount / totalEnrollments) * 100) : 0,
      notStarted: totalEnrollments > 0 ? Math.round((enrolledCount / totalEnrollments) * 100) : 0,
      totalStaff: totalStaffAssigned, // Add total staff for donut label
    },
  };
}

// Assign course to users
export async function assignCourseToUsers(courseId: string, emails: string[], dueAt?: Date) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // 1. Verify Course Ownership
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { createdBy: true, title: true },
  });

  if (!course || course.createdBy !== session.user.id) {
    throw new Error('Course not found or unauthorized');
  }

  // 2. Get Current User's Org to ensure we only assign to own staff
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  if (!currentUser?.organizationId) {
    throw new Error('You must belong to an organization to assign courses');
  }

  // 3. Find Users by Email (filtered by Org)
  const usersToAssign = await prisma.user.findMany({
    where: {
      organizationId: currentUser.organizationId,
      email: { in: emails },
    },
    select: { id: true, email: true },
  });

  if (usersToAssign.length === 0) {
    return { success: false, message: 'No valid users found to assign.' };
  }

  // 4. Create Enrollments (skip duplicates)
  const enrollmentData = usersToAssign.map((u) => ({
    userId: u.id,
    courseId: courseId,
    status: 'enrolled',
    progress: 0,
    startedAt: new Date(),
  }));

  const results = await prisma.enrollment.createMany({
    data: enrollmentData,
    skipDuplicates: true,
  });

  revalidatePath('/dashboard/training');
  return { success: true, count: results.count };
}

// Create full course with content and assignments
export async function createFullCourse(data: {
  title: string;
  description: string;
  category: string;
  difficulty: string;
  duration: string;
  objectives?: string[];
  modules: { title: string; content: string; duration: string }[];
  quiz: QuizQuestion[];
  assignments: string[];
  dueDate?: Date;
  dueTime?: string;
  // Quiz settings from Step 4
  quizTitle?: string;
  quizPassMark?: string;
  quizQuestionType?: string;
  quizAttempts?: string;
  quizDuration?: string;
  quizDifficulty?: string;
  documentId?: string;
  // v3.1 raw JSON for persistence
  rawCourseJson?: unknown;
  rawQuizJson?: unknown;
  // v4.6 raw artifacts for persistence
  rawArticleMeta?: unknown;
  rawArticleMarkdown?: string;
  rawSlidesJson?: unknown;
  rawJudgeJson?: unknown;
}) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Get currentUser for Org ID
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  if (!currentUser?.organizationId) {
    throw new Error('Organization not found');
  }

  // Detect prompt version
  const promptVersion = data.rawArticleMeta ? 'v4.6' : data.rawCourseJson ? 'v3.1' : undefined;

  // 1. Create Course, Lessons, Quiz in one transaction (nested write)
  const course = await prisma.course.create({
    data: {
      title: data.title,
      description: data.description,
      category: data.category,
      duration: parseInt(data.duration) || 0,
      objectives: data.objectives || [],
      status: 'published',
      createdBy: session.user.id,
      // Pipeline version tracking
      promptVersion,
      // v3.1 fields
      rawCourseJson: data.rawCourseJson || undefined,
      rawQuizJson: data.rawQuizJson || undefined,
      // v4.6 fields
      rawArticleMeta: data.rawArticleMeta || undefined,
      rawArticleMarkdown: data.rawArticleMarkdown || undefined,
      rawSlidesJson: data.rawSlidesJson || undefined,
      rawJudgeJson: data.rawJudgeJson || undefined,
      lessons: {
        create: data.modules.map((mod, index) => ({
          title: mod.title,
          content: mod.content,
          order: index,
          duration: parseInt(mod.duration.replace(' min', '')) || 10,
          quiz:
            index === data.modules.length - 1 && data.quiz.length > 0
              ? {
                  create: {
                    title: data.quizTitle || 'Course Quiz',
                    passingScore: parseInt(data.quizPassMark?.replace('%', '') || '70'),
                    allowedAttempts:
                      data.quizAttempts === 'unlimited' || !data.quizAttempts
                        ? null
                        : parseInt(data.quizAttempts),
                    timeLimit: parseInt(data.quizDuration?.replace(/\D/g, '') || '15'),
                    difficulty: data.quizDifficulty || 'medium',
                    questions: {
                      create: data.quiz.map((q, qIndex) => ({
                        text: q.question,
                        type: q.type || data.quizQuestionType || 'multiple_choice',
                        options: q.options,
                        correctAnswer: q.options[q.answer],
                        order: qIndex,
                        // v3.1 embedded fields
                        explanation: q.explanation?.correctExplanation || undefined,
                        archetype: q.archetype || undefined,
                        evidence: q.evidence || undefined,
                      })),
                    },
                  },
                }
              : undefined,
        })),
      },
    },
  });

  // 1.5 Link Document if provided
  if (data.documentId) {
    // Find latest version of the document
    const latestDocVersion = await prisma.documentVersion.findFirst({
      where: { documentId: data.documentId },
      orderBy: { version: 'desc' },
    });

    if (latestDocVersion) {
      await prisma.courseVersion.create({
        data: {
          courseId: course.id,
          documentVersionId: latestDocVersion.id,
          version: 1, // Initial version
        },
      });
    }
  }

  // 2. Handle Assignments (existing members + new invites)
  const inviteResults = {
    existingEnrolled: 0,
    newInvited: 0,
    failed: [] as string[],
    skipped: [] as string[],
  };

  if (data.assignments && data.assignments.length > 0) {
    const { sendCourseInviteEmail } = await import('@/lib/email');
    const bcrypt = await import('bcryptjs');
    const crypto = await import('crypto');

    // Email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Filter valid emails only
    const validEmails = data.assignments.filter((email) => {
      if (!emailRegex.test(email)) {
        inviteResults.skipped.push(email);
        return false;
      }
      return true;
    });

    if (validEmails.length === 0) {
      revalidatePath('/dashboard/training');
      return {
        success: true,
        courseId: course.id,
        inviteResults,
      };
    }

    // Get org details for email
    const org = await prisma.organization.findUnique({
      where: { id: currentUser.organizationId },
      select: { name: true },
    });
    const orgName = org?.name || 'Your Organization';

    // Find existing users in this org
    const existingUsers = await prisma.user.findMany({
      where: {
        organizationId: currentUser.organizationId,
        email: { in: validEmails },
      },
      include: { profile: true },
    });
    const existingEmails = existingUsers.map((u) => u.email);

    // Check for users that exist in OTHER organizations (can't invite)
    const usersInOtherOrgs = await prisma.user.findMany({
      where: {
        email: { in: validEmails },
        organizationId: { not: currentUser.organizationId },
      },
      select: { email: true },
    });
    const otherOrgEmails = usersInOtherOrgs.map((u) => u.email);
    otherOrgEmails.forEach((e) => inviteResults.skipped.push(e));

    // Identify truly new emails (not in any org)
    const newEmails = validEmails.filter(
      (e) => !existingEmails.includes(e) && !otherOrgEmails.includes(e),
    );

    // Create new users for new emails
    const newUserIds: string[] = [];
    for (const email of newEmails) {
      try {
        const tempPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        // Create user + profile
        const newUser = await prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            role: 'worker',
            organizationId: currentUser.organizationId,
            emailVerified: true,
            profile: {
              create: {
                email,
                fullName: email.split('@')[0],
              },
            },
          },
        });

        newUserIds.push(newUser.id);

        // Send invite email (don't fail the whole process if email fails)
        try {
          await sendCourseInviteEmail(email, tempPassword, data.title, orgName);
          inviteResults.newInvited++;
        } catch (emailError) {
          console.error(`Failed to send email to ${email}:`, emailError);
          // User was created, just email failed - still enroll them
          inviteResults.newInvited++;
        }
      } catch (userError) {
        console.error(`Failed to create user ${email}:`, userError);
        inviteResults.failed.push(email);
      }
    }

    // Combine all user IDs for enrollment
    const allUserIds = [...existingUsers.map((u) => u.id), ...newUserIds];

    if (allUserIds.length > 0) {
      try {
        await prisma.enrollment.createMany({
          data: allUserIds.map((userId) => ({
            userId,
            courseId: course.id,
            status: 'enrolled',
            startedAt: new Date(),
          })),
          skipDuplicates: true,
        });
        inviteResults.existingEnrolled = existingUsers.length;

        // Send enrollment emails to existing users
        const { sendCourseEnrollmentEmail } = await import('@/lib/email');

        // We do this asynchronously without awaiting to not block the response
        Promise.allSettled(
          existingUsers.map((user) =>
            sendCourseEnrollmentEmail(
              user.email,
              user.profile?.fullName || 'there',
              course.title,
              orgName,
            ).catch((err) =>
              console.error(`Failed to send enrollment email to ${user.email}`, err),
            ),
          ),
        );
      } catch (enrollError) {
        console.error('Failed to create enrollments:', enrollError);
      }
    }
  }

  revalidatePath('/dashboard/training');
  return {
    success: true,
    courseId: course.id,
    inviteResults,
  };
}

// Attest a course completion
export async function attestCourse(enrollmentId: string, signature: string, role: string) {
  // Resolve BOTH sessions to handle cookie collision (admin + worker in same browser)
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: {
        include: {
          profile: true,
        },
      },
      course: true,
    },
  });

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  // Check if EITHER session owns this enrollment (handles cookie collision)
  if (enrollment.userId !== adminId && enrollment.userId !== workerId) {
    throw new Error('Unauthorized');
  }

  // Verify signature matches authenticated user name
  const userName = enrollment.user.profile?.fullName || enrollment.user.email || '';
  if (signature.trim() !== userName) {
    throw new Error(`Signature must match your account name: ${userName}`);
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'attested',
      attestedAt: new Date(),
      attestationSignature: signature,
      attestationRole: role,
    },
  });

  // Notify Admins of course completion
  if (enrollment.user.organizationId) {
    await notifyOrganizationAdmins(enrollment.user.organizationId, {
      type: 'COURSE_PASSED',
      title: 'Course Completed',
      message: `${enrollment.user.profile?.fullName || enrollment.user.email} has completed and attested to the course: ${enrollment.course?.title || 'Unknown Course'}.`,
      linkUrl: `/dashboard/staff/${enrollment.user.id}`,
      metadata: { userId: enrollment.user.id, courseId: enrollment.courseId },
    });
  }

  revalidatePath('/worker');
  revalidatePath(`/learn/${enrollment.courseId}`);
  return { success: true };
}

// Start a course (mark as in_progress)
export async function startCourse(courseId: string) {
  // Resolve BOTH sessions to handle cookie collision
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  // Try to find enrollment for either session user
  let enrollment = null;
  if (workerId) {
    enrollment = await prisma.enrollment.findFirst({
      where: { courseId, userId: workerId },
    });
  }
  if (!enrollment && adminId) {
    enrollment = await prisma.enrollment.findFirst({
      where: { courseId, userId: adminId },
    });
  }

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  if (enrollment.status === 'enrolled' || enrollment.status === 'assigned') {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: 'in_progress',
        progress: enrollment.progress === 0 ? 1 : enrollment.progress, // Ensure at least 1%
        startedAt: enrollment.startedAt || new Date(),
      },
    });

    revalidatePath('/dashboard/worker');
    revalidatePath(`/worker/courses/${courseId}`);
  }

  return { success: true };
}

// Update quiz questions (Admin)
export async function updateQuizQuestions(
  courseId: string,
  questions: {
    question: string;
    options: string[];
    answer: number;
    type?: string;
  }[],
) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { lessons: { include: { quiz: true } } },
  });

  if (!course || course.createdBy !== session.user.id) {
    throw new Error('Unauthorized or Course not found');
  }

  const lessonWithQuiz = course.lessons.find((l) => l.quiz);
  if (!lessonWithQuiz || !lessonWithQuiz.quiz) {
    throw new Error('Quiz not found in this course');
  }
  const quizId = lessonWithQuiz.quiz.id;

  await prisma.$transaction(async (tx) => {
    await tx.question.deleteMany({ where: { quizId: quizId } });
    if (questions.length > 0) {
      await tx.question.createMany({
        data: questions.map((q, index) => ({
          quizId: quizId,
          text: q.question,
          type: q.type || 'multiple_choice',
          options: q.options,
          correctAnswer: q.options[q.answer],
          order: index,
        })),
      });
    }
  });

  revalidatePath(`/learn/${courseId}`);
  return { success: true };
}

// Update lesson content (Admin)
export async function updateLessonContent(lessonId: string, content: string, title?: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { course: true },
  });

  if (!lesson || lesson.course.createdBy !== session.user.id) {
    throw new Error('Unauthorized or Lesson not found');
  }

  await prisma.lesson.update({
    where: { id: lessonId },
    data: {
      content,
      title: title || lesson.title,
    },
  });

  revalidatePath(`/learn/${lesson.courseId}`);
  return { success: true };
}

// Retake a quiz (reset status to in_progress)
export async function retakeQuiz(enrollmentId: string) {
  // Resolve BOTH sessions to handle cookie collision
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
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
  });

  // Check if EITHER session owns this enrollment
  if (!enrollment || (enrollment.userId !== adminId && enrollment.userId !== workerId)) {
    throw new Error('Enrollment not found or unauthorized');
  }

  const lastLesson = enrollment.course.lessons[enrollment.course.lessons.length - 1];
  const quiz = lastLesson?.quiz;
  const latestAttempt = enrollment.quizAttempts[0];

  if (quiz && quiz.allowedAttempts) {
    const attemptsUsed = latestAttempt?.attemptCount || 0;
    if (attemptsUsed >= quiz.allowedAttempts) {
      throw new Error('No attempts remaining');
    }
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'in_progress',
      score: null,
      completedAt: null,
      attestedAt: null,
      attestationSignature: null,
    },
  });

  revalidatePath(`/learn/${enrollment.courseId}`);
  return { success: true };
}

// Assign a retake for a locked enrollment (admin only)
export async function assignRetake(enrollmentId: string, retakeReason?: string) {
  // Only admins can assign retakes
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const adminUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  if (!adminUser || adminUser.role !== 'admin') {
    throw new Error('Insufficient permissions');
  }

  const lockedEnrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: { include: { profile: true } },
      course: true,
    },
  });

  if (!lockedEnrollment) {
    throw new Error('Enrollment not found');
  }

  if (lockedEnrollment.status !== 'locked') {
    throw new Error('Enrollment is not locked');
  }

  const retakeEnrollment = await prisma.enrollment.create({
    data: {
      userId: lockedEnrollment.userId,
      courseId: lockedEnrollment.courseId,
      status: 'enrolled',
      progress: 100,
      retakeOf: lockedEnrollment.id,
      retakeReason: retakeReason || null,
      assignedByAdminId: session.user.id,
    },
  });

  await prisma.notification.updateMany({
    where: {
      type: { in: ['QUIZ_RETRY_LIMIT_REACHED', 'COURSE_RETRY_REQUESTED'] },
      resolvedAt: null,
      metadata: { path: ['enrollmentId'], equals: enrollmentId },
    },
    data: {
      resolvedAt: new Date(),
      isRead: true,
    },
  });

  const { createNotification } = await import('./notifications');
  await createNotification({
    userId: lockedEnrollment.userId,
    type: 'RETAKE_ASSIGNED',
    title: 'Retake Assigned',
    message: `An admin has assigned you a retake for "${lockedEnrollment.course.title}". You can now take the quiz again.`,
    linkUrl: `/learn/${lockedEnrollment.courseId}`,
    metadata: {
      enrollmentId: retakeEnrollment.id,
      courseId: lockedEnrollment.courseId,
      parentEnrollmentId: lockedEnrollment.id,
    },
  });

  revalidatePath('/dashboard/staff');
  revalidatePath('/worker/trainings');
  revalidatePath(`/learn/${lockedEnrollment.courseId}`);

  return { success: true, retakeEnrollmentId: retakeEnrollment.id };
}
