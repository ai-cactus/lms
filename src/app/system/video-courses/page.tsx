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
    return {
      id: row.id,
      title: row.title,
      durationSeconds: lesson?.videoDurationSeconds ?? null,
      duration: row.duration ?? null,
      questionCount: lesson?.quiz?._count?.questions ?? 0,
      offeringsCount: row._count.offerings,
      enrollmentsCount: row._count.enrollments,
      createdAt: row.createdAt.toISOString(),
    };
  });

  return <VideoCoursesClient courses={courses} />;
}
