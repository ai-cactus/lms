import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export type JobType =
  | 'GENERATE_DRAFT'
  | 'EXPORT_PACK'
  | 'GENERATE_V46_COURSE'
  | 'GENERATE_V3_COURSE';

export async function createJob(
  type: JobType,
  payload: Record<string, unknown> & { userId?: string },
) {
  const job = await prisma.job.create({
    data: {
      type,
      userId: payload.userId,
      payload: payload as unknown as Prisma.InputJsonValue,
      status: 'queued',
    },
  });

  // Mock async processing
  processJob(job.id, payload).catch((err) => console.error('Job Processing Error', err));

  return job;
}

async function processJob(jobId: string, payload: Record<string, unknown>) {
  // Simulate delay
  await new Promise((resolve) => setTimeout(resolve, 3000));

  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'processing' },
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  // MOCK: specific logic for GENERATE_DRAFT
  let result: Record<string, unknown> = {
    message: 'Successfully processed',
    timestamp: Date.now(),
  };

  try {
    if (payload.documentVersionId && payload.userId) {
      // Create a Mock Course
      const course = await prisma.course.create({
        data: {
          title: 'Generated Course from Document',
          description: 'Automatically generated from compliance doc.',
          createdBy: payload.userId as string,
          status: 'draft',
        },
      });
      result = { ...result, courseId: course.id } as Record<string, unknown>;
    }
  } catch (e) {
    console.error('Failed to create course in job', e);
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      result: result as unknown as Prisma.InputJsonValue,
    },
  });
}
