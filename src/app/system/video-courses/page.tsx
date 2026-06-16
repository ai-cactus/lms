import { notFound } from 'next/navigation';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { listGlobalVideoCourses } from '@/app/actions/video-course';
import VideoCoursesClient from './VideoCoursesClient';

export const dynamic = 'force-dynamic';

export default async function VideoCoursesPage() {
  const isAdmin = await verifySystemAdminCookie();
  if (!isAdmin) notFound();

  const rows = await listGlobalVideoCourses();

  const courses = rows.map((row) => {
    const lesson = row.lessons[0] ?? null;

    // A course is "processing" while any of its videos (lectures or preview) is
    // still being normalized; "failed" if any failed; otherwise "ready".
    const videoStatuses = [
      ...row.lessons.filter((l) => l.videoStorageUri).map((l) => l.mediaStatus),
      ...(row.previewMediaStatus ? [row.previewMediaStatus] : []),
    ];
    const mediaStatus: 'processing' | 'ready' | 'failed' = videoStatuses.includes('processing')
      ? 'processing'
      : videoStatuses.includes('failed')
        ? 'failed'
        : 'ready';

    return {
      id: row.id,
      title: row.title,
      durationSeconds: lesson?.videoDurationSeconds ?? null,
      duration: row.duration ?? null,
      questionCount: row.quiz?._count?.questions ?? lesson?.quiz?._count?.questions ?? 0,
      offeringsCount: row._count.offerings,
      enrollmentsCount: row._count.enrollments,
      createdAt: row.createdAt.toISOString(),
      mediaStatus,
    };
  });

  return <VideoCoursesClient courses={courses} />;
}
