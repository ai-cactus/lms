import { notFound } from 'next/navigation';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import prisma from '@/lib/prisma';
import EditVideoCourseClient from './EditVideoCourseClient';

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

  return <EditVideoCourseClient initial={initial} />;
}
