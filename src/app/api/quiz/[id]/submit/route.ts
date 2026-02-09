import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const quizId = params.id;
        const body = await request.json();
        const { enrollmentId, answers, timeTaken } = body;

        // Verify enrollment belongs to user
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId }
        });

        if (!enrollment || enrollment.userId !== session.user.id) {
            return NextResponse.json({ error: 'Enrollment not found' }, { status: 403 });
        }

        // Get quiz with questions
        const quiz = await prisma.quiz.findUnique({
            where: { id: quizId },
            include: { questions: true }
        });

        if (!quiz) {
            return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
        }

        // Calculate score
        let correctCount = 0;
        for (const answer of answers) {
            const question = quiz.questions.find(q => q.id === answer.questionId);
            if (question && question.correctAnswer === answer.selectedAnswer) {
                correctCount++;
            }
        }

        const totalQuestions = quiz.questions.length;
        const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
        const passed = score >= quiz.passingScore;

        // Check if attempt already exists
        const existingAttempt = await prisma.quizAttempt.findUnique({
            where: {
                enrollmentId_quizId: {
                    enrollmentId,
                    quizId
                }
            }
        });

        if (existingAttempt) {
            // Update existing attempt
            await prisma.quizAttempt.update({
                where: { id: existingAttempt.id },
                data: {
                    answers,
                    score,
                    timeTaken,
                    completedAt: new Date()
                }
            });
        } else {
            // Create new attempt
            await prisma.quizAttempt.create({
                data: {
                    enrollmentId,
                    quizId,
                    answers,
                    score,
                    timeTaken
                }
            });
        }

        // Update enrollment status and score
        await prisma.enrollment.update({
            where: { id: enrollmentId },
            data: {
                status: passed ? 'completed' : 'in_progress',
                score,
                progress: 100, // They finished the course
                completedAt: passed ? new Date() : null
            }
        });

        revalidatePath('/dashboard/learner');

        return NextResponse.json({
            score,
            passed,
            correctCount,
            totalQuestions
        });

    } catch (error) {
        console.error('Error submitting quiz:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
