import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { z } from 'zod';

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

    // Check active attempt
    const attempt = await prisma.quizAttempt.findUnique({
      where: {
        enrollmentId_quizId: { enrollmentId, quizId },
      },
      include: { enrollment: true },
    });

    if (!attempt) {
      return NextResponse.json({ error: 'No attempt found' }, { status: 404 });
    }

    if (
      attempt.enrollment.userId !== workerSession?.user?.id &&
      attempt.enrollment.userId !== adminSession?.user?.id
    ) {
      return NextResponse.json(
        { error: 'Enrollment does not belong to active sessions' },
        { status: 403 },
      );
    }

    if (attempt.timeTaken !== null) {
      return NextResponse.json({ error: 'Attempt is already completed' }, { status: 409 });
    }

    // Update answers
    await prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        answers: answers, // Replace answers JSON
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving quiz progress:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
