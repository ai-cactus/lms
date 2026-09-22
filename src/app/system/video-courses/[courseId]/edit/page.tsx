import { notFound } from 'next/navigation';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import prisma from '@/lib/prisma';
import { buildSystemCourseThumbnailUrl, resolveCourseThumbnailSource } from '@/lib/video/thumbnail';
import { MAX_THUMBNAIL_UPLOAD_BYTES } from '@/lib/video/upload-config';
import EditVideoCourseClient from './EditVideoCourseClient';

function regenerateBlockedReason(
  lesson: { videoStorageUri: string | null; mediaStatus: string } | undefined,
): string | null {
  if (!lesson?.videoStorageUri) return 'Upload a course video before generating a thumbnail.';
  if (lesson.mediaStatus === 'processing') {
    return 'Available once the course video has finished processing.';
  }
  if (lesson.mediaStatus !== 'ready') {
    return 'The course video failed to process, so no frame can be taken from it.';
  }
  return null;
}

export const dynamic = 'force-dynamic';

export default async function EditVideoCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  if (!(await verifySystemAdminCookie())) notFound();
  const { courseId } = await params;

  const course = await prisma.course.findFirst({
    where: { id: courseId, type: 'video', isGlobal: true },
    include: {
      // The course video is the first lesson by order.
      lessons: { orderBy: { order: 'asc' }, take: 1 },
      quiz: { include: { _count: { select: { questions: true } } } },
    },
  });
  if (!course) notFound();

  const primaryLesson = course.lessons[0];

  const initial = {
    courseId: course.id,
    title: course.title,
    description: course.description ?? '',
    overview: course.overview ?? '',
    skillLevel: (course.skillLevel ?? '') as 'beginner' | 'intermediate' | 'advanced' | '',
    category: course.category ?? '',
    duration: course.duration ?? null,
    passingScore: course.quiz?.passingScore ?? 70,
    allowedAttempts: course.quiz?.allowedAttempts ?? 1,
    questionCount: course.quiz?._count.questions ?? 0,
    previewExistingUri: course.previewVideoStorageUri ?? null,
    previewDurationSeconds: course.previewVideoDurationSeconds ?? null,
    courseVideoExistingUri: primaryLesson?.videoStorageUri ?? null,
    courseVideoDurationSeconds: primaryLesson?.videoDurationSeconds ?? null,
  };

  const thumbnail = {
    courseId: course.id,
    source: resolveCourseThumbnailSource({
      type: course.type,
      thumbnailStorageUri: course.thumbnailStorageUri,
      previewPosterStorageUri: course.previewPosterStorageUri,
      firstLessonPosterStorageUri: primaryLesson?.videoPosterStorageUri,
    }),
    imageUrl: buildSystemCourseThumbnailUrl(course, primaryLesson),
    regenerateBlockedReason: regenerateBlockedReason(primaryLesson),
    maxUploadBytes: MAX_THUMBNAIL_UPLOAD_BYTES,
  };

  return <EditVideoCourseClient initial={initial} thumbnail={thumbnail} />;
}
