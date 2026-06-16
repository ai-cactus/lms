'use server';

import { prisma } from '@/lib/prisma';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { getOrCreateSystemUser } from '@/lib/video/system-user';
import type { ParsedQuiz } from '@/lib/video/types';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';

export interface CreateVideoLectureInput {
  title: string;
  order: number;
  videoStorageUri: string;
  videoDurationSeconds?: number;
}

export interface CreateVideoModuleInput {
  title: string;
  order: number;
  lectures: CreateVideoLectureInput[];
}

export interface CreateVideoCourseInput {
  title: string;
  description?: string;
  overview?: string;
  skillLevel?: 'beginner' | 'intermediate' | 'advanced';
  category?: string;
  objectives?: string[];
  duration?: number;
  passingScore: number;
  allowedAttempts: number;
  previewVideoStorageUri?: string;
  previewVideoDurationSeconds?: number;
  modules: CreateVideoModuleInput[];
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

  const passingScore = input.quiz.passingScore ?? input.passingScore;
  const allowedAttempts = input.quiz.allowedAttempts ?? input.allowedAttempts;

  // Derive total duration (minutes) from lecture seconds when not provided.
  const totalLectureSeconds = input.modules
    .flatMap((m) => m.lectures)
    .reduce((sum, l) => sum + (l.videoDurationSeconds ?? 0), 0);
  const duration =
    input.duration ??
    (totalLectureSeconds > 0 ? Math.max(1, Math.round(totalLectureSeconds / 60)) : null);

  // Collected inside the transaction so we can enqueue a transcode job per
  // source video once the rows exist.
  const videoTargets: {
    targetType: 'lesson' | 'course-preview';
    targetId: string;
    storageUri: string;
  }[] = [];

  const courseId = await prisma.$transaction(async (tx) => {
    const course = await tx.course.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        overview: input.overview ?? null,
        skillLevel: input.skillLevel ?? null,
        category: input.category ?? null,
        objectives: input.objectives ?? [],
        duration,
        previewVideoStorageUri: input.previewVideoStorageUri ?? null,
        previewVideoDurationSeconds: input.previewVideoDurationSeconds ?? null,
        // Preview video starts as "processing" until the transcode job normalizes it.
        previewMediaStatus: input.previewVideoStorageUri ? 'processing' : null,
        type: 'video',
        isGlobal: true,
        status: 'published',
        createdBy: system.id,
      },
    });

    for (const moduleInput of input.modules) {
      const courseModule = await tx.courseModule.create({
        data: {
          courseId: course.id,
          title: moduleInput.title,
          order: moduleInput.order,
        },
      });

      for (const lecture of moduleInput.lectures) {
        const lessonRow = await tx.lesson.create({
          data: {
            courseId: course.id,
            moduleId: courseModule.id,
            title: lecture.title,
            content: '',
            order: lecture.order,
            duration:
              lecture.videoDurationSeconds != null
                ? Math.max(1, Math.round(lecture.videoDurationSeconds / 60))
                : null,
            videoProvider: 'self',
            videoStorageUri: lecture.videoStorageUri,
            videoDurationSeconds: lecture.videoDurationSeconds ?? null,
            // A lecture with a video starts "processing" until normalized.
            mediaStatus: lecture.videoStorageUri ? 'processing' : 'ready',
          },
        });
        if (lecture.videoStorageUri) {
          videoTargets.push({
            targetType: 'lesson',
            targetId: lessonRow.id,
            storageUri: lecture.videoStorageUri,
          });
        }
      }
    }

    const quiz = await tx.quiz.create({
      data: {
        courseId: course.id,
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

  // Normalize every source video to a web-safe, faststart MP4 in the background
  // (see video-transcode-queue). Best-effort: a transcode is an optimization,
  // not a hard dependency — if Redis is down the raw upload still plays.
  if (input.previewVideoStorageUri) {
    videoTargets.push({
      targetType: 'course-preview',
      targetId: courseId,
      storageUri: input.previewVideoStorageUri,
    });
  }
  for (const target of videoTargets) {
    try {
      const { enqueueVideoTranscode } = await import('@/lib/queue/video-transcode-queue');
      await enqueueVideoTranscode(target);
    } catch (err) {
      logger.warn({ msg: '[video-course] failed to enqueue transcode', err, target });
      // No worker will process it — clear "processing" so the UI doesn't hang.
      try {
        if (target.targetType === 'lesson') {
          await prisma.lesson.update({
            where: { id: target.targetId },
            data: { mediaStatus: 'ready' },
          });
        } else {
          await prisma.course.update({
            where: { id: target.targetId },
            data: { previewMediaStatus: 'ready' },
          });
        }
      } catch {
        /* best-effort */
      }
    }
  }

  logger.info({ msg: '[video-course] created', courseId, transcodeJobs: videoTargets.length });
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
      // Quiz is course-level for video courses; include it for the question count.
      quiz: { include: { _count: { select: { questions: true } } } },
      _count: { select: { offerings: true, enrollments: true } },
    },
  });
}

export async function deleteVideoCourse(courseId: string) {
  await assertSystemAdmin();
  await prisma.course.delete({ where: { id: courseId } });
  revalidatePath('/system/video-courses');
}
