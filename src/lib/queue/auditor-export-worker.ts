import { Worker } from 'bullmq';
import { redis } from './redis';
import prisma from '@/lib/prisma';
import { AUDITOR_EXPORT_QUEUE_NAME } from './auditor-export-queue';
import { logger } from '@/lib/logger';
import { Prisma } from '@/generated/prisma/browser';

export function getExportWorker() {
  const globalAny = globalThis as unknown as { __auditorWorker?: Worker };
  if (globalAny.__auditorWorker) {
    return globalAny.__auditorWorker;
  }

  const worker = new Worker(
    AUDITOR_EXPORT_QUEUE_NAME,
    async (job) => {
      const {
        organizationId,
        dbJobId,
        scope = 'org',
        scopeId,
      } = job.data as {
        organizationId: string;
        dbJobId: string;
        scope?: 'org' | 'course' | 'staff';
        scopeId?: string;
      };
      if (!organizationId) throw new Error('organizationId missing');

      const updateDbJob = async (prog: number, message: string) => {
        if (dbJobId) {
          const existing = await prisma.job.findUnique({
            where: { id: dbJobId },
            select: { payload: true },
          });
          const prev = (existing?.payload as Record<string, unknown>) ?? {};
          await prisma.job.update({
            where: { id: dbJobId },
            data: {
              payload: { ...prev, progress: prog, message },
              status: prog === 100 ? 'completed' : 'processing',
            },
          });
        }
        await job.updateProgress(prog);
      };

      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      });
      const orgName = org?.name || 'Organization';

      const orgUserIds = await prisma.user
        .findMany({ where: { organizationId }, select: { id: true } })
        .then((u) => u.map((x) => x.id));

      await updateDbJob(15, 'Fetching records...');
      await new Promise((r) => setTimeout(r, 600));

      const { buildCourseReport, buildStaffReport, buildOrgReport } =
        await import('@/lib/audit-reports/report-data');

      let result;

      if (scope === 'course' && scopeId) {
        const course = await prisma.course.findUnique({
          where: { id: scopeId },
          include: {
            quiz: { include: { _count: { select: { questions: true } } } },
            lessons: {
              include: { quiz: { include: { _count: { select: { questions: true } } } } },
            },
            enrollments: {
              where: { userId: { in: orgUserIds } },
              include: { user: { include: { profile: true } }, quizAttempts: true },
            },
          },
        });
        if (!course) throw new Error('Course not found');

        await updateDbJob(60, 'Aggregating course evidence...');
        await new Promise((r) => setTimeout(r, 600));

        const courseVersions = await prisma.courseVersion.findMany({
          where: { courseId: scopeId },
          include: { documentVersion: { include: { document: true } } },
          orderBy: { version: 'desc' },
        });

        const quizRules = [
          course.quiz
            ? {
                title: course.quiz.title,
                passingScore: course.quiz.passingScore,
                allowedAttempts: course.quiz.allowedAttempts,
                timeLimit: course.quiz.timeLimit,
                questionCount: course.quiz._count.questions,
              }
            : null,
          ...course.lessons
            .filter((l) => l.quiz)
            .map((l) => ({
              title: l.quiz!.title,
              passingScore: l.quiz!.passingScore,
              allowedAttempts: l.quiz!.allowedAttempts,
              timeLimit: l.quiz!.timeLimit,
              questionCount: l.quiz!._count.questions,
            })),
        ].filter((q): q is NonNullable<typeof q> => q !== null);

        result = buildCourseReport({
          orgName,
          generatedAt: new Date(),
          course: {
            title: course.title,
            category: course.category,
            type: course.type,
            skillLevel: course.skillLevel,
            status: course.status,
            objectives: course.objectives ?? [],
            duration: course.duration,
          },
          quizRules,
          documents: courseVersions.map((cv) => ({
            name: cv.documentVersion.document.originalName,
            version: cv.documentVersion.version,
            hash: cv.documentVersion.hash,
          })),
          enrollments: course.enrollments.map((en) => ({
            staffName: en.user.profile?.fullName || en.user.email,
            status: en.status,
            score: en.score,
            attempts: en.quizAttempts.reduce((sum, a) => sum + a.attemptCount, 0),
            completedAt: en.completedAt,
          })),
        });
      } else if (scope === 'staff' && scopeId) {
        const staff = await prisma.user.findFirst({
          where: { id: scopeId, organizationId },
          include: {
            profile: true,
            enrollments: {
              include: {
                course: { select: { title: true, type: true, category: true } },
                quizAttempts: true,
              },
              orderBy: { startedAt: 'desc' },
            },
          },
        });
        if (!staff) throw new Error('Staff not found');

        await updateDbJob(60, 'Aggregating staff transcript...');
        await new Promise((r) => setTimeout(r, 600));

        result = buildStaffReport({
          orgName,
          generatedAt: new Date(),
          staff: {
            name: staff.profile?.fullName || staff.email.split('@')[0],
            roleLabel: staff.profile?.jobTitle || staff.role,
            email: staff.email,
          },
          enrollments: staff.enrollments.map((en) => ({
            courseTitle: en.course.title,
            type: en.course.type,
            category: en.course.category,
            status: en.status,
            score: en.score,
            attempts: en.quizAttempts.reduce((sum, a) => sum + a.attemptCount, 0),
            dateAssigned: en.startedAt,
            dateCompleted: en.completedAt,
          })),
        });
      } else if (scope === 'course' || scope === 'staff') {
        // scopeId was missing for a non-org scope — refuse rather than silently
        // producing an org-wide report.
        throw new Error(`scopeId required for ${scope} scope`);
      } else {
        // org scope
        const [enrollments, totalCourses, totalStaff] = await Promise.all([
          prisma.enrollment.findMany({
            where: { userId: { in: orgUserIds } },
            include: {
              user: { include: { profile: { select: { fullName: true } } } },
              course: { select: { title: true, category: true } },
            },
            orderBy: [{ user: { email: 'asc' } }, { startedAt: 'desc' }],
          }),
          prisma.course.count({ where: { createdBy: { in: orgUserIds }, status: 'published' } }),
          prisma.user.count({ where: { organizationId, role: 'worker' } }),
        ]);

        await updateDbJob(60, 'Aggregating organization activity...');
        await new Promise((r) => setTimeout(r, 600));

        const completed = enrollments.filter((e) =>
          ['completed', 'attested'].includes(e.status),
        ).length;
        const completionRate =
          enrollments.length > 0 ? Math.round((completed / enrollments.length) * 100) : 0;

        result = buildOrgReport({
          orgName,
          generatedAt: new Date(),
          summary: { totalCourses, totalStaff, completionRate },
          enrollments: enrollments.map((en) => ({
            staffName: en.user.profile?.fullName || en.user.email,
            courseTitle: en.course.title,
            category: en.course.category,
            status: en.status,
            score: en.score,
            dateAssigned: en.startedAt,
            dateCompleted: en.completedAt,
          })),
        });
      }

      await updateDbJob(90, 'Finalizing report...');
      await new Promise((r) => setTimeout(r, 400));

      if (dbJobId) {
        const existing = await prisma.job.findUnique({
          where: { id: dbJobId },
          select: { payload: true },
        });
        const prev = (existing?.payload as Record<string, unknown>) ?? {};
        await prisma.job.update({
          where: { id: dbJobId },
          data: {
            status: 'completed',
            payload: { ...prev, progress: 100, message: 'Report Ready' },
            result: result as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return result;
    },
    { connection: redis },
  );

  worker.on('failed', async (job, err) => {
    logger.error({ msg: `Export Job ${job?.id} failed:`, err: err });
    if (job?.data?.dbJobId) {
      await prisma.job.update({
        where: { id: job.data.dbJobId },
        data: {
          status: 'failed',
          payload: { progress: 0, message: 'Export failed due to server error' },
        },
      });
    }
  });

  globalAny.__auditorWorker = worker;
  return worker;
}
