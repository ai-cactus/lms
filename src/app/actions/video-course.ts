'use server';

import { prisma } from '@/lib/prisma';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { getOrCreateSystemUser } from '@/lib/video/system-user';
import type { ParsedQuiz } from '@/lib/video/types';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';

export interface CreateVideoCourseInput {
  title: string;
  description?: string;
  category?: string;
  objectives?: string[];
  duration?: number;
  passingScore: number;
  allowedAttempts: number;
  videoStorageUri: string;
  videoDurationSeconds?: number;
  quiz: ParsedQuiz;
}

async function assertSystemAdmin() {
  if (!(await verifySystemAdminCookie())) throw new Error('Unauthorized');
}

export async function createVideoCourse(
  input: CreateVideoCourseInput,
): Promise<{ courseId: string }> {
  await assertSystemAdmin();
  const system = await getOrCreateSystemUser();

  // Quiz-file overrides take precedence over the form-level defaults.
  const passingScore = input.quiz.passingScore ?? input.passingScore;
  const allowedAttempts = input.quiz.allowedAttempts ?? input.allowedAttempts;

  const courseId = await prisma.$transaction(async (tx) => {
    const course = await tx.course.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? null,
        objectives: input.objectives ?? [],
        duration: input.duration ?? null,
        type: 'video',
        isGlobal: true,
        status: 'published',
        createdBy: system.id,
      },
    });

    const lesson = await tx.lesson.create({
      data: {
        courseId: course.id,
        title: input.title,
        content: '',
        order: 1,
        duration: input.duration ?? null,
        videoProvider: 'self',
        videoStorageUri: input.videoStorageUri,
        videoDurationSeconds: input.videoDurationSeconds ?? null,
      },
    });

    const quiz = await tx.quiz.create({
      data: {
        lessonId: lesson.id,
        title: `${input.title} Quiz`,
        passingScore,
        allowedAttempts,
      },
    });

    await tx.question.createMany({
      data: input.quiz.questions.map((q) => ({
        quizId: quiz.id,
        text: q.text,
        type: 'multiple-choice',
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation ?? null,
        order: q.order,
      })),
    });

    return course.id;
  });

  logger.info({ msg: '[video-course] created', courseId });
  revalidatePath('/system/video-courses');
  return { courseId };
}

export async function listGlobalVideoCourses() {
  await assertSystemAdmin();
  return prisma.course.findMany({
    where: { type: 'video', isGlobal: true },
    orderBy: { createdAt: 'desc' },
    include: {
      lessons: {
        include: {
          quiz: {
            include: {
              _count: { select: { questions: true } },
            },
          },
        },
      },
      _count: { select: { offerings: true, enrollments: true } },
    },
  });
}

export async function deleteVideoCourse(courseId: string) {
  await assertSystemAdmin();
  await prisma.course.delete({ where: { id: courseId } });
  revalidatePath('/system/video-courses');
}
