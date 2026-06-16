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

export interface UpdateVideoLectureInput {
  id?: string;
  title: string;
  order: number;
  videoStorageUri?: string; // new/replacement; omit = keep existing
  videoDurationSeconds?: number;
}

export interface UpdateVideoModuleInput {
  id?: string;
  title: string;
  order: number;
  lectures: UpdateVideoLectureInput[];
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
  modules: UpdateVideoModuleInput[];
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
        modules: { select: { id: true, lessons: { select: { id: true, videoStorageUri: true } } } },
      },
    });
    if (!existing) throw new Error('Course not found');

    const existingModuleIds = new Set(existing.modules.map((m) => m.id));
    const existingLessonsById = new Map(
      existing.modules.flatMap((m) => m.lessons.map((l) => [l.id, l] as const)),
    );

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

    // Course-level quiz scoring (updateMany never throws if the row is absent).
    if (input.passingScore != null || input.allowedAttempts != null) {
      await tx.quiz.updateMany({
        where: { courseId },
        data: {
          ...(input.passingScore != null ? { passingScore: input.passingScore } : {}),
          ...(input.allowedAttempts != null ? { allowedAttempts: input.allowedAttempts } : {}),
        },
      });
    }

    // ── 1. Reconcile input modules/lessons; collect kept ids ──────
    const keptModuleIds = new Set<string>();
    const keptLessonIds = new Set<string>();

    for (const moduleInput of input.modules) {
      let moduleId: string;
      if (moduleInput.id) {
        if (!existingModuleIds.has(moduleInput.id)) {
          throw new Error('Module does not belong to this course');
        }
        await tx.courseModule.update({
          where: { id: moduleInput.id },
          data: { title: moduleInput.title, order: moduleInput.order },
        });
        moduleId = moduleInput.id;
      } else {
        const created = await tx.courseModule.create({
          data: { courseId, title: moduleInput.title, order: moduleInput.order },
        });
        moduleId = created.id;
      }
      keptModuleIds.add(moduleId);

      for (const lecture of moduleInput.lectures) {
        if (lecture.id) {
          if (!existingLessonsById.has(lecture.id)) {
            throw new Error('Lecture does not belong to this course');
          }
          keptLessonIds.add(lecture.id);
          const videoChanged =
            lecture.videoStorageUri != null &&
            lecture.videoStorageUri !== existingLessonsById.get(lecture.id)?.videoStorageUri;
          await tx.lesson.update({
            where: { id: lecture.id },
            data: {
              moduleId,
              title: lecture.title,
              order: lecture.order,
              ...(videoChanged
                ? {
                    videoStorageUri: lecture.videoStorageUri,
                    videoDurationSeconds: lecture.videoDurationSeconds ?? null,
                    duration:
                      lecture.videoDurationSeconds != null
                        ? Math.max(1, Math.round(lecture.videoDurationSeconds / 60))
                        : null,
                    mediaStatus: 'processing',
                  }
                : {}),
            },
          });
          if (videoChanged) {
            videoTargets.push({
              targetType: 'lesson',
              targetId: lecture.id,
              storageUri: lecture.videoStorageUri!,
            });
          }
        } else {
          const created = await tx.lesson.create({
            data: {
              courseId,
              moduleId,
              title: lecture.title,
              content: '',
              order: lecture.order,
              videoProvider: 'self',
              videoStorageUri: lecture.videoStorageUri ?? null,
              videoDurationSeconds: lecture.videoDurationSeconds ?? null,
              duration:
                lecture.videoDurationSeconds != null
                  ? Math.max(1, Math.round(lecture.videoDurationSeconds / 60))
                  : null,
              mediaStatus: lecture.videoStorageUri ? 'processing' : 'ready',
            },
          });
          keptLessonIds.add(created.id);
          if (lecture.videoStorageUri) {
            videoTargets.push({
              targetType: 'lesson',
              targetId: created.id,
              storageUri: lecture.videoStorageUri,
            });
          }
        }
      }
    }

    // ── 2. Delete existing lessons that weren't kept ──────────────
    // Covers lessons removed from kept chapters AND all lessons of removed
    // chapters — each deleted exactly once. (Moved lessons are in keptLessonIds.)
    for (const [lessonId] of existingLessonsById) {
      if (!keptLessonIds.has(lessonId)) {
        await tx.lesson.delete({ where: { id: lessonId } });
      }
    }

    // ── 3. Delete removed chapters (now empty) ────────────────────
    for (const existingModule of existing.modules) {
      if (!keptModuleIds.has(existingModule.id)) {
        await tx.courseModule.delete({ where: { id: existingModule.id } });
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
