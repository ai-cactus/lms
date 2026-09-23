import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';

const progressSchema = z.object({
  progress: z.number().min(0).max(100),
});

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const workerSession = await workerAuth();
    const adminSession = await adminAuth();

    const enrollmentId = params.id;
    const body = await request.json();

    const parsedBody = progressSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid input data', details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { progress } = parsedBody.data;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      // Nested, so the archive query extension leaves it alone — an archived
      // course must still be readable here in order to be refused.
      include: { course: { select: { archivedAt: true } } },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    if (
      enrollment.organizationUserId !== workerSession?.user?.organizationUserId &&
      enrollment.organizationUserId !== adminSession?.user?.organizationUserId
    ) {
      return NextResponse.json(
        { error: 'Enrollment does not belong to active sessions' },
        { status: 403 },
      );
    }

    // Q-04: progress is the learner advancing through the course, which stops
    // at the archive.
    if (enrollment.course.archivedAt) {
      logger.warn({
        msg: '[enrollment] Progress update blocked — course is archived',
        enrollmentId,
        courseId: enrollment.courseId,
      });
      return NextResponse.json({ error: ARCHIVED_COURSE_LEARNER_MESSAGE }, { status: 403 });
    }

    // Only allow forward progress (never decrease)
    const newProgress = Math.min(progress, 100);
    if (newProgress <= enrollment.progress) {
      return NextResponse.json({ success: true, message: 'Progress already ahead' });
    }

    let newStatus = enrollment.status;
    if (newProgress < 100) {
      newStatus = 'in_progress';
    } else if (
      newProgress === 100 &&
      enrollment.status !== 'completed' &&
      enrollment.status !== 'attested'
    ) {
      // All lessons done but quiz not yet taken
      newStatus = 'lessons_complete';
    }

    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        progress: newProgress,
        status: newStatus,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    logger.error({ msg: 'Error updating progress:', err: err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
