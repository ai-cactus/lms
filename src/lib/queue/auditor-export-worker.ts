import { Worker } from 'bullmq';
import { redis } from './redis';
import prisma from '@/lib/prisma';
import { AUDITOR_EXPORT_QUEUE_NAME } from './auditor-export-queue';
import { logger } from '@/lib/logger';
import { Prisma } from '@/generated/prisma/browser';
import { startedAtWhere, toReportPeriod } from '@/lib/audit-reports/date-range';
import type { OrgReportInput } from '@/lib/audit-reports/types';

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
        from,
        to,
      } = job.data as {
        organizationId: string;
        dbJobId: string;
        scope?: 'org' | 'course' | 'staff' | 'all-courses' | 'all-staff';
        scopeId?: string;
        from?: string | null;
        to?: string | null;
      };
      if (!organizationId) throw new Error('organizationId missing');

      // Date-range predicate applied to every enrollment query, plus the
      // JSON-serializable period surfaced in the report header.
      const dateWhere = startedAtWhere({ from, to });
      const period = toReportPeriod({ from, to });

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

      const {
        buildCourseReport,
        buildStaffReport,
        buildOrgReport,
        buildAllCoursesReport,
        buildAllStaffReport,
      } = await import('@/lib/audit-reports/report-data');

      const isCompleted = (status: string) => ['completed', 'attested'].includes(status);

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
              where: { userId: { in: orgUserIds }, ...dateWhere },
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
          period,
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
              where: dateWhere,
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
          period,
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
      } else if (scope === 'all-courses') {
        const [courses, totalStaff] = await Promise.all([
          prisma.course.findMany({
            where: { createdBy: { in: orgUserIds }, status: 'published' },
            select: {
              title: true,
              category: true,
              type: true,
              status: true,
              enrollments: {
                where: { userId: { in: orgUserIds }, ...dateWhere },
                select: { status: true },
              },
            },
            orderBy: { title: 'asc' },
          }),
          prisma.user.count({ where: { organizationId, role: 'worker' } }),
        ]);

        await updateDbJob(60, 'Aggregating course activity...');
        await new Promise((r) => setTimeout(r, 600));

        const totalEnrollments = courses.reduce((sum, c) => sum + c.enrollments.length, 0);
        const completedEnrollments = courses.reduce(
          (sum, c) => sum + c.enrollments.filter((e) => isCompleted(e.status)).length,
          0,
        );
        const completionRate =
          totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0;

        result = buildAllCoursesReport({
          orgName,
          generatedAt: new Date(),
          period,
          summary: { totalCourses: courses.length, totalStaff, completionRate },
          courses: courses.map((c) => ({
            courseTitle: c.title,
            category: c.category,
            type: c.type,
            status: c.status,
            assignedStaff: c.enrollments.length,
            completed: c.enrollments.filter((e) => isCompleted(e.status)).length,
          })),
        });
      } else if (scope === 'all-staff') {
        const [workers, totalCourses] = await Promise.all([
          prisma.user.findMany({
            where: { organizationId, role: 'worker' },
            select: {
              email: true,
              role: true,
              profile: { select: { fullName: true, jobTitle: true } },
              enrollments: {
                where: dateWhere,
                select: { status: true, completedAt: true },
                orderBy: { startedAt: 'desc' },
              },
            },
            orderBy: { createdAt: 'desc' },
          }),
          prisma.course.count({ where: { createdBy: { in: orgUserIds }, status: 'published' } }),
        ]);

        await updateDbJob(60, 'Aggregating staff activity...');
        await new Promise((r) => setTimeout(r, 600));

        const totalEnrollments = workers.reduce((sum, w) => sum + w.enrollments.length, 0);
        const completedEnrollments = workers.reduce(
          (sum, w) => sum + w.enrollments.filter((e) => isCompleted(e.status)).length,
          0,
        );
        const completionRate =
          totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0;

        result = buildAllStaffReport({
          orgName,
          generatedAt: new Date(),
          period,
          summary: { totalCourses, totalStaff: workers.length, completionRate },
          staff: workers.map((w) => ({
            staffName: w.profile?.fullName || w.email.split('@')[0],
            roleLabel: w.profile?.jobTitle || w.role,
            email: w.email,
            coursesAssigned: w.enrollments.length,
            coursesCompleted: w.enrollments.filter((e) => isCompleted(e.status)).length,
            lastActivity: w.enrollments.find((e) => e.completedAt)?.completedAt ?? null,
          })),
        });
      } else {
        // org scope
        const [totalCourses, totalStaff] = await Promise.all([
          prisma.course.count({ where: { createdBy: { in: orgUserIds }, status: 'published' } }),
          prisma.user.count({ where: { organizationId, role: 'worker' } }),
        ]);

        await updateDbJob(60, 'Aggregating organization activity...');
        await new Promise((r) => setTimeout(r, 600));

        // F-028: a large org can have far more enrollments than fit comfortably in
        // memory. Read them in bounded batches, mapping each batch into the
        // lightweight report shape and releasing the heavy Prisma rows (with their
        // user/course includes) before the next batch, so peak memory stays flat.
        // `id` is appended to the sort as a stable tiebreaker — required to make
        // skip/take batching deterministic when rows tie on (user email, startedAt).
        const ENROLLMENT_BATCH_SIZE = 1000;
        const orgEnrollments: OrgReportInput['enrollments'] = [];
        let completed = 0;
        for (let skip = 0; ; skip += ENROLLMENT_BATCH_SIZE) {
          const batch = await prisma.enrollment.findMany({
            where: { userId: { in: orgUserIds }, ...dateWhere },
            include: {
              user: { include: { profile: { select: { fullName: true } } } },
              course: { select: { title: true, category: true } },
            },
            orderBy: [{ user: { email: 'asc' } }, { startedAt: 'desc' }, { id: 'asc' }],
            skip,
            take: ENROLLMENT_BATCH_SIZE,
          });
          if (batch.length === 0) break;

          for (const en of batch) {
            if (['completed', 'attested'].includes(en.status)) completed++;
            orgEnrollments.push({
              staffName: en.user.profile?.fullName || en.user.email,
              courseTitle: en.course.title,
              category: en.course.category,
              status: en.status,
              score: en.score,
              dateAssigned: en.startedAt,
              dateCompleted: en.completedAt,
            });
          }

          if (batch.length < ENROLLMENT_BATCH_SIZE) break;
        }

        const completionRate =
          orgEnrollments.length > 0 ? Math.round((completed / orgEnrollments.length) * 100) : 0;

        result = buildOrgReport({
          orgName,
          generatedAt: new Date(),
          period,
          summary: { totalCourses, totalStaff, completionRate },
          enrollments: orgEnrollments,
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
