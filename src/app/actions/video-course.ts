'use server';

import prisma from '@/lib/prisma';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { getOrCreateSystemUser } from '@/lib/video/system-user';
import type { ParsedQuiz } from '@/lib/video/types';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';

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
  // The single course video, stored as one module-less lesson.
  courseVideo: { storageUri: string; durationSeconds?: number };
  quiz: ParsedQuiz;
}

export interface UpdateVideoCourseInput {
  title: string;
  description?: string;
  overview?: string;
  skillLevel?: 'beginner' | 'intermediate' | 'advanced';
  category?: string;
  duration?: number;
  passingScore?: number;
  allowedAttempts?: number;
  previewVideoStorageUri?: string; // new/replacement; omit = keep existing
  previewVideoDurationSeconds?: number;
  // The single course video. `storageUri` omitted = keep existing video.
  courseVideo?: { storageUri?: string; durationSeconds?: number };
  // A replacement quiz (parsed from a new CSV/JSON file). When provided, every
  // existing question is deleted and recreated from this file (full replace).
  // Omit = keep the existing quiz untouched.
  quiz?: ParsedQuiz;
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

  // Derive total duration (minutes) from the course video seconds when not provided.
  const courseVideoSeconds = input.courseVideo.durationSeconds ?? 0;
  const duration =
    input.duration ??
    (courseVideoSeconds > 0 ? Math.max(1, Math.round(courseVideoSeconds / 60)) : null);

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

    // The course video is stored as a single module-less lesson (no chapters).
    const lessonRow = await tx.lesson.create({
      data: {
        courseId: course.id,
        moduleId: null,
        title: input.title,
        content: '',
        order: 0,
        duration:
          input.courseVideo.durationSeconds != null
            ? Math.max(1, Math.round(input.courseVideo.durationSeconds / 60))
            : null,
        videoProvider: 'self',
        videoStorageUri: input.courseVideo.storageUri,
        videoDurationSeconds: input.courseVideo.durationSeconds ?? null,
        // The video starts "processing" until the transcode job normalizes it.
        mediaStatus: 'processing',
      },
    });
    videoTargets.push({
      targetType: 'lesson',
      targetId: lessonRow.id,
      storageUri: input.courseVideo.storageUri,
    });

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

export async function updateVideoCourse(
  courseId: string,
  input: UpdateVideoCourseInput,
): Promise<void> {
  await assertSystemAdmin();

  const videoTargets: {
    targetType: 'lesson' | 'course-preview';
    targetId: string;
    storageUri: string;
  }[] = [];

  await prisma.$transaction(async (tx) => {
    const existing = await tx.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        previewVideoStorageUri: true,
        // The course video is the first lesson by order (the module-less lesson
        // created for single-video courses; for legacy multi-lecture courses we
        // treat the first lecture as the course video and leave the rest intact).
        lessons: {
          orderBy: { order: 'asc' },
          take: 1,
          select: { id: true, videoStorageUri: true },
        },
      },
    });
    if (!existing) throw new Error('Course not found');

    // ── Course fields ─────────────────────────────────────────────
    const previewChanged =
      input.previewVideoStorageUri != null &&
      input.previewVideoStorageUri !== existing.previewVideoStorageUri;

    await tx.course.update({
      where: { id: courseId },
      data: {
        title: input.title,
        description: input.description ?? null,
        overview: input.overview ?? null,
        skillLevel: input.skillLevel ?? null,
        category: input.category ?? null,
        duration: input.duration ?? null,
        ...(input.previewVideoStorageUri != null
          ? {
              previewVideoStorageUri: input.previewVideoStorageUri,
              previewVideoDurationSeconds: input.previewVideoDurationSeconds ?? null,
              ...(previewChanged ? { previewMediaStatus: 'processing' as const } : {}),
            }
          : {}),
      },
    });
    if (previewChanged) {
      videoTargets.push({
        targetType: 'course-preview',
        targetId: courseId,
        storageUri: input.previewVideoStorageUri!,
      });
    }

    // A replacement quiz file may carry its own passing score / attempts; when
    // present those win over the form fields (parity with createVideoCourse).
    const passingScore = input.quiz?.passingScore ?? input.passingScore;
    const allowedAttempts = input.quiz?.allowedAttempts ?? input.allowedAttempts;

    // Course-level quiz scoring (updateMany never throws if the row is absent).
    if (passingScore != null || allowedAttempts != null) {
      await tx.quiz.updateMany({
        where: { courseId },
        data: {
          ...(passingScore != null ? { passingScore } : {}),
          ...(allowedAttempts != null ? { allowedAttempts } : {}),
        },
      });
    }

    // ── Quiz questions (full replace) ─────────────────────────────
    // When a new quiz file is uploaded we wipe and recreate every question.
    // Past QuizAttempt rows reference the quiz (not individual questions) and
    // are preserved, so attempt history and certificates stay intact.
    if (input.quiz) {
      const quizRow = await tx.quiz.findUnique({
        where: { courseId },
        select: { id: true },
      });
      const quizId =
        quizRow?.id ??
        (
          await tx.quiz.create({
            data: {
              courseId,
              title: `${input.title} Quiz`,
              passingScore: passingScore ?? 70,
              allowedAttempts: allowedAttempts ?? 1,
            },
            select: { id: true },
          })
        ).id;

      if (quizRow) {
        await tx.question.deleteMany({ where: { quizId } });
      }
      await tx.question.createMany({
        data: input.quiz.questions.map((q) => ({
          quizId,
          text: q.text,
          type: 'multiple-choice',
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation ?? null,
          order: q.order,
        })),
      });
    }

    // ── Course video (single module-less lesson) ─────────────────
    // Only touched when a new video was uploaded. Any other lessons/chapters
    // belonging to legacy multi-lecture courses are intentionally left intact.
    if (input.courseVideo?.storageUri) {
      const newUri = input.courseVideo.storageUri;
      const durationSeconds = input.courseVideo.durationSeconds ?? null;
      const lessonDuration =
        durationSeconds != null ? Math.max(1, Math.round(durationSeconds / 60)) : null;
      const primary = existing.lessons[0];

      if (primary) {
        const videoChanged = newUri !== primary.videoStorageUri;
        await tx.lesson.update({
          where: { id: primary.id },
          data: {
            title: input.title,
            videoStorageUri: newUri,
            videoDurationSeconds: durationSeconds,
            duration: lessonDuration,
            ...(videoChanged ? { mediaStatus: 'processing' as const } : {}),
          },
        });
        if (videoChanged) {
          videoTargets.push({ targetType: 'lesson', targetId: primary.id, storageUri: newUri });
        }
      } else {
        const created = await tx.lesson.create({
          data: {
            courseId,
            moduleId: null,
            title: input.title,
            content: '',
            order: 0,
            videoProvider: 'self',
            videoStorageUri: newUri,
            videoDurationSeconds: durationSeconds,
            duration: lessonDuration,
            mediaStatus: 'processing',
          },
        });
        videoTargets.push({ targetType: 'lesson', targetId: created.id, storageUri: newUri });
      }
    }
  });

  for (const target of videoTargets) {
    try {
      const { enqueueVideoTranscode } = await import('@/lib/queue/video-transcode-queue');
      await enqueueVideoTranscode(target);
    } catch (err) {
      logger.warn({ msg: '[video-course] failed to enqueue transcode (update)', err, target });
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

  logger.info({ msg: '[video-course] updated', courseId, transcodeJobs: videoTargets.length });
  revalidatePath('/system/video-courses');
  revalidatePath(`/system/video-courses/${courseId}/edit`);
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

/**
 * Soft delete / restore. Courses are never hard-deleted for compliance:
 * enrollments, certificates and attestation history must be preserved.
 * Setting `inactive` removes the course from the platform (the offering and
 * enrollment paths filter `status: 'published'`) while keeping every row.
 */
export async function setVideoCourseStatus(courseId: string, status: 'inactive' | 'published') {
  await assertSystemAdmin();
  await prisma.course.update({ where: { id: courseId }, data: { status } });
  revalidatePath('/system/video-courses');
}
