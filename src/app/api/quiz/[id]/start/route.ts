import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';

export async function POST(
    request: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    try {
        const workerSession = await workerAuth();
        const adminSession = await adminAuth();

        const quizId = params.id;
        const body = await request.json();
        const { enrollmentId } = body;

        if (!enrollmentId) {
            return NextResponse.json({ error: 'Enrollment ID required' }, { status: 400 });
        }

        // Verify enrollment
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId }
        });

        if (!enrollment) {
            return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
        }

        if (enrollment.userId !== workerSession?.user?.id && enrollment.userId !== adminSession?.user?.id) {
            return NextResponse.json({ error: 'Enrollment does not belong to active sessions' }, { status: 403 });
        }

        // Check for existing attempt
        // We look for ANY attempt for this enrollment+quiz
        // The unique constraint is @@unique([enrollmentId, quizId])
        // So there is only EVER one row per user per quiz in this schema.
        // This means we are effectively "Using the single slot" for the attempt.

        const existingAttempt = await prisma.quizAttempt.findUnique({
            where: {
                enrollmentId_quizId: { enrollmentId, quizId }
            }
        });

        if (existingAttempt) {
            // If it exists, we "reset" it for a new start, BUT only if previous one was completed???
            // OR if we are just "resuming" an active one?
            // The frontend calls "start" when clicking "Start Quiz".
            // If there is already an active attempt (timeTaken is null), we should just return it (Resume).
            // If there is a completed attempt, and we are allowed retakes, we reset it.

            // Logic:
            // 1. If timeTaken is NULL, it is ACTIVE. Return success (Resume).
            // 2. If timeTaken is NOT NULL, it is COMPLETED.
            //    Check retake policy. If allowed, RESET it (increment count, set timeTaken null, set completedAt = now() as start time).

            if (existingAttempt.timeTaken === null) {
                // Active attempt, just resume
                return NextResponse.json({ message: 'Resumed active attempt', attempt: existingAttempt });
            }

            // It is completed. Check if we can retake.
            const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
            const allowedAttempts = quiz?.allowedAttempts || 1;

            if (existingAttempt.attemptCount >= allowedAttempts) {
                return NextResponse.json({ error: 'No attempts remaining' }, { status: 403 });
            }

            // Start new attempt (reuse row)
            const updated = await prisma.quizAttempt.update({
                where: { id: existingAttempt.id },
                data: {
                    timeTaken: null, // Mark active
                    answers: [],     // Clear answers
                    score: 0,
                    completedAt: new Date(), // Acts as StartedAt for active attempts
                    attemptCount: { increment: 1 }
                }
            });
            return NextResponse.json({ message: 'Started new attempt', attempt: updated });

        } else {
            // Create first attempt
            const attempt = await prisma.quizAttempt.create({
                data: {
                    enrollmentId,
                    quizId,
                    answers: [],
                    score: 0,
                    timeTaken: null, // Mark active
                    completedAt: new Date(), // Acts as StartedAt
                    attemptCount: 1
                }
            });
            return NextResponse.json({ message: 'Started first attempt', attempt });
        }

    } catch (error) {
        console.error('Error starting quiz:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
