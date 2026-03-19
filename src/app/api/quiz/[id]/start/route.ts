import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { z } from 'zod';

const startQuizSchema = z.object({
  enrollmentId: z.string().min(1, 'Enrollment ID is required'),
});

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const workerSession = await workerAuth();
    const adminSession = await adminAuth();

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

    // Check for existing attempt
    // We look for ANY attempt for this enrollment+quiz
    // The unique constraint is @@unique([enrollmentId, quizId])
    // So there is only EVER one row per user per quiz in this schema.
    // This means we are effectively "Using the single slot" for the attempt.

    // Use a transaction to prevent race conditions (double-clicks bypassing attempt limit)
    const result = await prisma.$transaction(async (tx) => {
      const existingAttempt = await tx.quizAttempt.findUnique({
        where: {
          enrollmentId_quizId: { enrollmentId, quizId },
        },
      });

      if (existingAttempt) {
        if (existingAttempt.timeTaken === null) {
          // Active attempt, just resume
          return { status: 'resumed', attempt: existingAttempt };
        }

        // It is completed. Check if we can retake.
        const quiz = await tx.quiz.findUnique({ where: { id: quizId } });
        const allowedAttempts = quiz?.allowedAttempts || 1;

        if (existingAttempt.attemptCount >= allowedAttempts) {
          return { status: 'blocked' };
        }

        // Start new attempt (reuse row)
        const updated = await tx.quizAttempt.update({
          where: { id: existingAttempt.id },
          data: {
            timeTaken: null, // Mark active
            answers: [], // Clear answers
            score: 0,
            completedAt: new Date(), // Acts as StartedAt for active attempts
            attemptCount: { increment: 1 },
          },
        });
        return { status: 'started', attempt: updated };
      } else {
        // Create first attempt
        const attempt = await tx.quizAttempt.create({
          data: {
            enrollmentId,
            quizId,
            answers: [],
            score: 0,
            timeTaken: null, // Mark active
            completedAt: new Date(), // Acts as StartedAt
            attemptCount: 1,
          },
        });
        return { status: 'created', attempt };
      }
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
    console.error('Error starting quiz:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
