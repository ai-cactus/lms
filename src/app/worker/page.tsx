import { auth } from '@/auth.worker';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import WorkerWelcomeModal from '@/components/dashboard/learner/WorkerWelcomeModal';
import WorkerDashboardMetrics from '@/components/worker/WorkerDashboardMetrics';
import WorkerCourseList from '@/components/worker/WorkerCourseList';
import WorkerAchievements from '@/components/worker/WorkerAchievements';
import WorkerEmptyState from '@/components/worker/WorkerEmptyState';
import { getWorkerCertificates } from '@/app/actions/certificate';

export default async function LearnerDashboard() {
  const session = await auth();
  const userId = session?.user?.id;

  const [allEnrollments, user, allCertificates] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId },
      include: {
        course: true,
        quizAttempts: {
          orderBy: { completedAt: 'desc' },
          take: 1,
        },
      },
    }),
    userId
      ? prisma.user.findUnique({
          where: { id: userId },
          include: { profile: true },
        })
      : null,
    // Fetch certs only when a valid session exists; fall back to [] if not authed
    userId ? getWorkerCertificates().catch(() => []) : Promise.resolve([]),
  ]);

  // 3 most recent certificates for the achievements widget
  const recentCertificates = allCertificates.slice(0, 3);

  const profileIncomplete = !user?.profile?.firstName?.trim() || !user?.profile?.lastName?.trim();

  // Deduplicate: one entry per course, preferring completed/attested, then latest enrollment
  const latestByCourse = new Map<string, (typeof allEnrollments)[number]>();
  const completedByCourse = new Map<string, (typeof allEnrollments)[number]>();

  for (const e of allEnrollments) {
    const existing = latestByCourse.get(e.courseId);
    if (
      !existing ||
      (e.startedAt && existing.startedAt && e.startedAt > existing.startedAt) ||
      (!existing.startedAt && e.startedAt)
    ) {
      latestByCourse.set(e.courseId, e);
    }
    if (e.status === 'completed' || e.status === 'attested') {
      const existingCompleted = completedByCourse.get(e.courseId);
      if (!existingCompleted || e.status === 'attested') {
        completedByCourse.set(e.courseId, e);
      }
    }
  }

  const courses = [...latestByCourse.entries()].map(([courseId, e]) => {
    const completed = completedByCourse.get(courseId);
    const picked = completed ?? e;
    return {
      id: courseId,
      enrollmentId: picked.id,
      title: picked.course.title,
      status: picked.status,
      progress: picked.progress,
      deadline: null,
      duration: picked.course.duration || undefined,
      quizAttempts: picked.quizAttempts,
      retakeOf: picked.retakeOf,
    };
  });

  const totalCourses = courses.length;
  const completedCourses = courses.filter(
    (c) => c.status === 'attested' || c.status === 'completed',
  ).length;
  const badgeCount = completedCourses;

  // Calculate Average Grade (from deduplicated courses)
  const coursesWithScores = courses.filter((c) => {
    const enrollment = allEnrollments.find((e) => e.id === c.enrollmentId);
    return enrollment?.score !== null;
  });
  const averageGrade =
    coursesWithScores.length > 0
      ? Math.round(
          coursesWithScores.reduce((sum, c) => {
            const enrollment = allEnrollments.find((e) => e.id === c.enrollmentId);
            return sum + (enrollment?.score || 0);
          }, 0) / coursesWithScores.length,
        )
      : 0;

  // Check if completely empty (onboarding state)
  const showWelcomeModal = courses.length === 0;

  // Check for any progress to intelligently hide welcome modal
  const hasProgress = courses.some(
    (c) => (c.progress || 0) > 0 || c.status === 'completed' || c.status === 'attested',
  );

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 max-md:gap-5">
      {profileIncomplete && (
        <div className="mb-2 mt-4 flex items-center gap-4 rounded-lg border border-[#fef3c7] border-l-4 border-l-[#f59e0b] bg-[#fffbeb] px-5 py-4 shadow-sm">
          <div className="flex flex-shrink-0 items-center text-[#d97706]">
            <AlertCircle className="size-5" aria-hidden="true" />
          </div>
          <div className="text-sm font-medium leading-relaxed text-[#b45309]">
            Please{' '}
            <Link href="/worker/profile" className="font-bold underline hover:text-[#78350f]">
              update your profile
            </Link>{' '}
            with your official first and last name. This is required for your certificates to
            generate correctly.
          </div>
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-[#1a202c] max-md:text-xl">Dashboard</h1>
          <p className="text-[#718096]">Here is an overview of your courses</p>
        </div>
      </header>

      <WorkerDashboardMetrics
        totalCourses={totalCourses}
        completedCourses={completedCourses}
        averageGrade={averageGrade}
      />

      <WorkerCourseList courses={courses} />

      <WorkerAchievements
        badgeCount={badgeCount}
        recentCertificates={recentCertificates.map((cert) => ({
          id: cert.id,
          courseTitle: cert.course.title,
          issuedAt: cert.issuedAt,
        }))}
      />

      {showWelcomeModal && <WorkerEmptyState />}

      <WorkerWelcomeModal
        courseCount={courses.length}
        firstCourseId={courses[0]?.id}
        hasProgress={hasProgress}
      />
    </div>
  );
}
