import { Worker } from 'bullmq';
import { redis } from './redis';
import { prisma } from '@/lib/prisma';
import { AUDITOR_EXPORT_QUEUE_NAME } from './auditor-export-queue';
import { Prisma } from '@prisma/client';

export function getExportWorker() {
  const globalAny = globalThis as unknown as { __auditorWorker?: Worker };
  if (globalAny.__auditorWorker) {
    return globalAny.__auditorWorker;
  }

  const worker = new Worker(
    AUDITOR_EXPORT_QUEUE_NAME,
    async (job) => {
      const { organizationId, dbJobId } = job.data;
      if (!organizationId) throw new Error('organizationId missing');

      const updateDbJob = async (prog: number, message: string) => {
        if (dbJobId) {
          await prisma.job.update({
            where: { id: dbJobId },
            data: {
              payload: { progress: prog, message },
              status: prog === 100 ? 'completed' : 'processing',
            },
          });
        }
        await job.updateProgress(prog);
      };

      await updateDbJob(10, 'Fetching organization users...');
      await new Promise((r) => setTimeout(r, 800));

      await updateDbJob(35, 'Fetching enrollments and quizzes...');
      await new Promise((r) => setTimeout(r, 800));

      const enrollments = await prisma.enrollment.findMany({
        where: { user: { organizationId } },
        include: {
          course: {
            include: {
              lessons: {
                include: {
                  quiz: {
                    include: {
                      questions: true,
                    },
                  },
                },
              },
            },
          },
          user: { include: { profile: true } },
          quizAttempts: true,
        },
      });

      await updateDbJob(70, 'Aggregating and structuring report...');
      await new Promise((r) => setTimeout(r, 800));

      const compiledData = enrollments.map((en) => {
        const rawMeta = en.course.rawArticleMeta as Record<string, unknown> | null;
        return {
          staffName: en.user.profile?.fullName || en.user.email,
          courseTitle: en.course.title,
          status: en.status,
          score: en.score,
          attested: !!en.attestationSignature,
          attestationRole: en.attestationRole || 'N/A',
          attestationDate: en.attestedAt?.toISOString() || null,
          courseSummary:
            en.course.description || (rawMeta?.title as string) || 'No summary provided',
          quizzes: en.course.lessons
            .map((l) => {
              if (!l.quiz) return null;
              return {
                title: l.quiz.title,
                passingScore: l.quiz.passingScore,
                questions: l.quiz.questions.map((q) => ({
                  text: q.text,
                  options: (q.options as string[]) ?? [],
                  correctAnswer: q.correctAnswer,
                })),
                attempts: en.quizAttempts
                  .filter((qa) => qa.quizId === l.quiz!.id)
                  .map((a) => ({
                    score: a.score,
                    completedAt: a.completedAt.toISOString(),
                  })),
              };
            })
            .filter(Boolean),
        };
      });

      await updateDbJob(90, 'Finalizing export format...');
      await new Promise((r) => setTimeout(r, 800));

      if (dbJobId) {
        await prisma.job.update({
          where: { id: dbJobId },
          data: {
            status: 'completed',
            payload: { progress: 100, message: 'Export Ready' },
            result: compiledData as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return compiledData;
    },
    { connection: redis },
  );

  worker.on('failed', async (job, err) => {
    console.error(`Export Job ${job?.id} failed:`, err);
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
