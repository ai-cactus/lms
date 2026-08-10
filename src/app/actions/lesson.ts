'use server';

import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

/**
 * F-034: every mutator in this file previously checked only that SOME session
 * existed, then that the course's `createdByOrgUserId` matched the caller's
 * membership. Ownership is not authorization — any authenticated member of the
 * org, a worker included, could create, edit, delete and reorder lesson content.
 *
 * A lesson is course content, so the permission is `course.edit`. The registry
 * has no `lesson.*` entry and inventing one would fragment the model for no
 * gain: there is no role that should edit lessons but not the course containing
 * them.
 *
 * Throws rather than returning an error object, matching this file's style.
 */
function assertCanEditCourseContent(
  session: { user: { id: string; role: Role } },
  action: string,
  context: Record<string, unknown> = {},
): void {
  if (!can(dbRoleToRoleKey(session.user.role), 'course.edit')) {
    logger.warn({
      msg: `[lesson] ${action} denied — missing course.edit`,
      ...context,
      userId: session.user.id,
      role: session.user.role,
    });
    throw new Error('Insufficient permissions');
  }
}

export async function createLesson(data: {
  courseId: string;
  title: string;
  content: string;
  duration?: number;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  assertCanEditCourseContent(session, 'createLesson', { courseId: data.courseId });

  const course = await prisma.course.findUnique({
    where: { id: data.courseId },
    include: { lessons: { select: { order: true } } },
  });
  if (!course || course.createdByOrgUserId !== session.user.organizationUserId) {
    throw new Error('Course not found');
  }

  const maxOrder = course.lessons.reduce((max, l) => Math.max(max, l.order), 0);

  const lesson = await prisma.lesson.create({
    data: {
      courseId: data.courseId,
      title: data.title,
      content: data.content,
      duration: data.duration || null,
      order: maxOrder + 1,
    },
  });

  revalidatePath(`/dashboard/training/${data.courseId}`);
  return lesson;
}

export async function updateLesson(
  lessonId: string,
  data: {
    title?: string;
    content?: string;
    duration?: number;
  },
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  assertCanEditCourseContent(session, 'updateLesson', { lessonId });

  const existing = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { course: true },
  });
  if (!existing || existing.course.createdByOrgUserId !== session.user.organizationUserId) {
    throw new Error('Lesson not found');
  }

  const lesson = await prisma.lesson.update({
    where: { id: lessonId },
    data,
  });

  revalidatePath(`/dashboard/training/${existing.courseId}`);
  return lesson;
}

export async function deleteLesson(lessonId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  assertCanEditCourseContent(session, 'deleteLesson', { lessonId });

  const existing = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { course: true },
  });
  if (!existing || existing.course.createdByOrgUserId !== session.user.organizationUserId) {
    throw new Error('Lesson not found');
  }

  await prisma.lesson.delete({ where: { id: lessonId } });

  // Reorder remaining lessons
  const remainingLessons = await prisma.lesson.findMany({
    where: { courseId: existing.courseId },
    orderBy: { order: 'asc' },
  });

  for (let i = 0; i < remainingLessons.length; i++) {
    await prisma.lesson.update({
      where: { id: remainingLessons[i].id },
      data: { order: i + 1 },
    });
  }

  revalidatePath(`/dashboard/training/${existing.courseId}`);
  return { success: true };
}

export async function reorderLessons(
  courseId: string,
  lessonOrder: { id: string; order: number }[],
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  assertCanEditCourseContent(session, 'reorderLessons', { courseId });

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course || course.createdByOrgUserId !== session.user.organizationUserId) {
    throw new Error('Course not found');
  }

  await prisma.$transaction(
    lessonOrder.map((item) =>
      prisma.lesson.update({
        where: { id: item.id },
        data: { order: item.order },
      }),
    ),
  );

  revalidatePath(`/dashboard/training/${courseId}`);
  return { success: true };
}

export async function createLessonWithQuiz(data: {
  courseId: string;
  title: string;
  content: string;
  duration?: number;
  quiz?: {
    title: string;
    passingScore?: number;
    questions: {
      text: string;
      type: string;
      options?: string[];
      correctAnswer: string;
    }[];
  };
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  assertCanEditCourseContent(session, 'createLessonWithQuiz', { courseId: data.courseId });

  const course = await prisma.course.findUnique({
    where: { id: data.courseId },
    include: { lessons: { select: { order: true } } },
  });
  if (!course || course.createdByOrgUserId !== session.user.organizationUserId) {
    throw new Error('Course not found');
  }

  const maxOrder = course.lessons.reduce((max, l) => Math.max(max, l.order), 0);

  const lesson = await prisma.lesson.create({
    data: {
      courseId: data.courseId,
      title: data.title,
      content: data.content,
      duration: data.duration || null,
      order: maxOrder + 1,
      quiz: data.quiz
        ? {
            create: {
              title: data.quiz.title,
              passingScore: data.quiz.passingScore || 70,
              questions: {
                create: data.quiz.questions.map((q, i) => ({
                  text: q.text,
                  type: q.type,
                  options: q.options ? q.options : Prisma.DbNull,
                  correctAnswer: q.correctAnswer,
                  order: i + 1,
                })),
              },
            },
          }
        : undefined,
    },
    include: { quiz: { include: { questions: true } } },
  });

  revalidatePath(`/dashboard/training/${data.courseId}`);
  return lesson;
}
