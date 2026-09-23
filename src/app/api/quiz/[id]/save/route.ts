import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { guardApiSession } from '@/lib/auth-guard';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';

const saveQuizSchema = z.object({
  enrollmentId: z.string().min(1, 'Enrollment ID is required'),
  answers: z.array(
    z.object({
      questionId: z.string(),
      selectedAnswer: z.string(),
    }),
  ),
});

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const workerSession = await workerAuth();
    const adminSession = await adminAuth();

    // F-012: enforce authentication + MFA step-up at the data-access layer.
    const denied = guardApiSession(workerSession ?? adminSession);
    if (denied) return denied;

    const quizId = params.id;
    const body = await request.json();

    const parsedBody = saveQuizSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid input data', details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { enrollmentId, answers } = parsedBody.data;

    // Save into the latest attempt for this enrollment+quiz. Append-history means
    // there can be several completed rows plus at most one in-progress draft;
    // the latest row (completedAt desc) is the one currently being taken.
    const attempt = await prisma.quizAttempt.findFirst({
      where: { enrollmentId, quizId },
      orderBy: { completedAt: 'desc' },
      include: { enrollment: { include: { course: { select: { archivedAt: true } } } } },
    });

    if (!attempt) {
      return NextResponse.json({ error: 'No attempt found' }, { status: 404 });
    }

    if (
      attempt.enrollment.organizationUserId !== workerSession?.user?.organizationUserId &&
      attempt.enrollment.organizationUserId !== adminSession?.user?.organizationUserId
    ) {
      return NextResponse.json(
        { error: 'Enrollment does not belong to active sessions' },
        { status: 403 },
      );
    }

    // Q-04: an archived course stops accepting learner writes, and an in-flight
    // draft is still a learner write.
    if (attempt.enrollment.course.archivedAt) {
      logger.warn({
        msg: '[quiz] Answer save blocked — course is archived',
        enrollmentId,
        courseId: attempt.enrollment.courseId,
      });
      return NextResponse.json({ error: ARCHIVED_COURSE_LEARNER_MESSAGE }, { status: 403 });
    }

    if (attempt.timeTaken !== null) {
      return NextResponse.json({ error: 'Attempt is already completed' }, { status: 409 });
    }

    await prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        answers: answers,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ msg: 'Error saving quiz progress:', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
