import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { guardApiSession } from '@/lib/auth-guard';

const startQuizSchema = z.object({
  enrollmentId: z.string().min(1, 'Enrollment ID is required'),
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

    const parsedBody = startQuizSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid input data', details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { enrollmentId } = parsedBody.data;

    // Verify enrollment
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    if (
      enrollment.userId !== workerSession?.user?.id &&
      enrollment.userId !== adminSession?.user?.id
    ) {
      return NextResponse.json(
        { error: 'Enrollment does not belong to active sessions' },
        { status: 403 },
      );
    }

    // Guard: block if enrollment is locked (attempts exhausted)
    if (enrollment.status === 'locked') {
      return NextResponse.json(
        {
          error: 'QUIZ_LOCKED_MAX_ATTEMPTS',
          message:
            'You have used all allowed attempts for this quiz. An admin must assign a retake.',
        },
        { status: 403 },
      );
    }

    // Attempts are append-history: each completed attempt is its own row, plus
    // at most one in-progress "draft" row (timeTaken === null) for the attempt
    // currently being taken. Use a transaction to prevent race conditions
    // (double-clicks bypassing the attempt limit).
    const result = await prisma.$transaction(async (tx) => {
      // Resume the current in-progress draft if one exists.
      const activeAttempt = await tx.quizAttempt.findFirst({
        where: { enrollmentId, quizId, timeTaken: null },
        orderBy: { completedAt: 'desc' },
      });

      if (activeAttempt) {
        return { status: 'resumed' as const, attempt: activeAttempt };
      }

      // No active draft — start a new attempt, enforcing the limit against the
      // count of COMPLETED attempts (timeTaken !== null).
      const quiz = await tx.quiz.findUnique({ where: { id: quizId } });
      const allowedAttempts = quiz?.allowedAttempts ?? 1;

      const completedCount = await tx.quizAttempt.count({
        where: { enrollmentId, quizId, timeTaken: { not: null } },
      });

      if (completedCount >= allowedAttempts) {
        return { status: 'blocked' as const };
      }

      const attempt = await tx.quizAttempt.create({
        data: {
          enrollmentId,
          quizId,
          answers: [],
          score: 0,
          timeTaken: null, // Mark active (in-progress draft)
          completedAt: new Date(), // Acts as StartedAt for active attempts
          attemptCount: completedCount + 1,
        },
      });
      return {
        status: completedCount === 0 ? ('created' as const) : ('started' as const),
        attempt,
      };
    });

    if (result.status === 'blocked') {
      return NextResponse.json({ error: 'No attempts remaining' }, { status: 403 });
    }

    const message =
      result.status === 'resumed'
        ? 'Resumed active attempt'
        : result.status === 'created'
          ? 'Started first attempt'
          : 'Started new attempt';
    return NextResponse.json({ message, attempt: result.attempt });
  } catch (error) {
    logger.error({ msg: 'Error starting quiz:', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
