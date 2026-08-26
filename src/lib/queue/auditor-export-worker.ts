import { Worker } from 'bullmq';
import { redis } from './redis';
import prisma from '@/lib/prisma';
import { AUDITOR_EXPORT_QUEUE_NAME } from './auditor-export-queue';
import { logger } from '@/lib/logger';
import { Prisma } from '@/generated/prisma/browser';
import { startedAtWhere, toReportPeriod } from '@/lib/audit-reports/date-range';
import { WORKER_ROLES } from '@/lib/rbac/role-utils';
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
        facilityIds,
      } = job.data as {
        organizationId: string;
        dbJobId: string;
        scope?: 'org' | 'course' | 'staff' | 'all-courses' | 'all-staff';
        scopeId?: string;
        from?: string | null;
        to?: string | null;
        /**
         * D-01. Derived server-side at /start from the caller's session — never
         * from the request body. `null` = org-wide; an array narrows the SUBJECT
         * axis below. `scope` selects the report's subject kind; this is an
         * orthogonal axis and must not be folded into it.
         */
        facilityIds?: string[] | null;
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

      // D-01 + team finding #17. One id array is not enough, because the report
      // has two axes that must scope differently:
      //
      //   SUBJECTS — whose training records may appear. Facility-narrowed.
      //              This is the security boundary.
      //   AUTHORS  — who created the organisation's courses. NEVER narrowed.
      //              The course CATALOGUE is an org-level artifact.
      //
      // Narrowing the author axis too would delete a course from a supervisor's
      // report entirely whenever it happens to have been written by someone at
      // another facility — the report would read "this facility has no
      // bloodborne-pathogens course" when it has one with no local enrollments.
      // That is a worse audit artifact than the leak we are closing. #17 asks
      // for exactly this asymmetry: all courses listed, the DATA facility-limited.
      const facilityScoped = Array.isArray(facilityIds);

      const authorOrgUserIds = await prisma.organizationUser
        .findMany({ where: { organizationId, active: true }, select: { id: true } })
        .then((u) => u.map((x) => x.id));

      const subjectOrgUserIds = facilityScoped
        ? await prisma.organizationUser
            .findMany({
              where: {
                organizationId,
                active: true,
                // Membership, not Enrollment.facilityId: that column records the
                // facility at enrollment time and is nullable, so a transferred
                // worker's records would surface under their FORMER supervisor
                // while their name is absent from that supervisor's roster.
                facilities: { some: { facilityId: { in: facilityIds }, active: true } },
              },
              select: { id: true },
            })
            .then((u) => u.map((x) => x.id))
        : authorOrgUserIds;

      // The SUBJECT-side predicate for direct OrganizationUser queries below.
      const subjectFacilityWhere = facilityScoped
        ? { facilities: { some: { facilityId: { in: facilityIds }, active: true } } }
        : {};

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
              where: { organizationUserId: { in: subjectOrgUserIds }, ...dateWhere },
              include: { organizationUser: { include: { user: true } }, quizAttempts: true },
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
            staffName: en.organizationUser.user.fullName || en.organizationUser.user.email,
            status: en.status,
            score: en.score,
            attempts: en.quizAttempts.reduce((sum, a) => sum + a.attemptCount, 0),
            completedAt: en.completedAt,
          })),
        });
      } else if (scope === 'staff' && scopeId) {
        // scopeId is the OrganizationUser id — the org-scoped staff identity —
        // not the bare global User id.
        const staff = await prisma.organizationUser.findFirst({
          where: { id: scopeId, organizationId, ...subjectFacilityWhere },
          include: {
            user: true,
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
            name: staff.user.fullName || staff.user.email.split('@')[0],
            roleLabel: staff.jobTitle || staff.role,
            email: staff.user.email,
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
            where: { createdByOrgUserId: { in: authorOrgUserIds }, status: 'published' },
            select: {
              title: true,
              category: true,
              type: true,
              status: true,
              enrollments: {
                where: { organizationUserId: { in: subjectOrgUserIds }, ...dateWhere },
                select: { status: true },
              },
            },
            orderBy: { title: 'asc' },
          }),
          prisma.organizationUser.count({
            where: {
              organizationId,
              active: true,
              role: { in: [...WORKER_ROLES] },
              ...subjectFacilityWhere,
            },
          }),
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
          prisma.organizationUser.findMany({
            // #17: "when viewing the workers tab, the tab should display all
            // workers in that specific facility only".
            where: {
              organizationId,
              active: true,
              role: { in: [...WORKER_ROLES] },
              ...subjectFacilityWhere,
            },
            select: {
              role: true,
              jobTitle: true,
              user: { select: { email: true, fullName: true } },
              enrollments: {
                where: dateWhere,
                select: { status: true, completedAt: true },
                orderBy: { startedAt: 'desc' },
              },
            },
            orderBy: { createdAt: 'desc' },
          }),
          prisma.course.count({
            where: { createdByOrgUserId: { in: authorOrgUserIds }, status: 'published' },
          }),
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
            staffName: w.user.fullName || w.user.email.split('@')[0],
            roleLabel: w.jobTitle || w.role,
            email: w.user.email,
            coursesAssigned: w.enrollments.length,
            coursesCompleted: w.enrollments.filter((e) => isCompleted(e.status)).length,
            lastActivity: w.enrollments.find((e) => e.completedAt)?.completedAt ?? null,
          })),
        });
      } else {
        const [totalCourses, totalStaff] = await Promise.all([
          prisma.course.count({
            where: { createdByOrgUserId: { in: authorOrgUserIds }, status: 'published' },
          }),
          prisma.organizationUser.count({
            where: {
              organizationId,
              active: true,
              role: { in: [...WORKER_ROLES] },
              ...subjectFacilityWhere,
            },
          }),
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
            where: { organizationUserId: { in: subjectOrgUserIds }, ...dateWhere },
            include: {
              organizationUser: { include: { user: { select: { email: true, fullName: true } } } },
              course: { select: { title: true, category: true } },
            },
            orderBy: [
              { organizationUser: { user: { email: 'asc' } } },
              { startedAt: 'desc' },
              { id: 'asc' },
            ],
            skip,
            take: ENROLLMENT_BATCH_SIZE,
          });
          if (batch.length === 0) break;

          for (const en of batch) {
            if (['completed', 'attested'].includes(en.status)) completed++;
            orgEnrollments.push({
              staffName: en.organizationUser.user.fullName || en.organizationUser.user.email,
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
