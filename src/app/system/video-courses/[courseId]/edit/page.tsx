import { notFound } from 'next/navigation';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { prisma } from '@/lib/prisma';
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
      modules: {
        orderBy: { order: 'asc' },
        include: { lessons: { orderBy: { order: 'asc' } } },
      },
      quiz: { include: { _count: { select: { questions: true } } } },
    },
  });
  if (!course) notFound();

  const initial = {
    courseId: course.id,
    title: course.title,
    description: course.description ?? '',
    overview: course.overview ?? '',
    skillLevel: (course.skillLevel ?? 'beginner') as 'beginner' | 'intermediate' | 'advanced',
    category: course.category ?? '',
    duration: course.duration ?? null,
    passingScore: course.quiz?.passingScore ?? 70,
    allowedAttempts: course.quiz?.allowedAttempts ?? 1,
    questionCount: course.quiz?._count.questions ?? 0,
    previewExistingUri: course.previewVideoStorageUri ?? null,
    previewDurationSeconds: course.previewVideoDurationSeconds ?? null,
    chapters: course.modules.map((m) => ({
      id: m.id,
      title: m.title,
      lectures: m.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        file: null as File | null,
        durationSeconds: l.videoDurationSeconds ?? null,
        existingVideoStorageUri: l.videoStorageUri ?? null,
      })),
    })),
  };

  return <EditVideoCourseClient initial={initial} />;
}
