'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';

/**
 * Get all available users (workers) that can be enrolled in courses.
 * Used by Share Modal to show selectable users.
 */
export async function getAvailableUsers() {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    // Get all users with worker role (or all users if needed)
    const users = await prisma.user.findMany({
        include: {
            profile: true,
        },
        orderBy: {
            createdAt: 'desc',
        },
    });

    return users.map(user => ({
        id: user.id,
        email: user.email,
        fullName: user.profile?.fullName || user.email,
        role: user.profile?.role || 'worker',
        avatarUrl: user.profile?.avatarUrl,
    }));
}

/**
 * Enroll users in a course by their email addresses.
 * Creates enrollment records for each valid email.
 */
export async function enrollUsers(courseId: string, emails: string[]) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    // Verify course exists and user owns it
    const course = await prisma.course.findUnique({
        where: { id: courseId },
    });

    if (!course || course.createdBy !== session.user.id) {
        throw new Error('Course not found');
    }

    const results = {
        success: [] as string[],
        alreadyEnrolled: [] as string[],
        notFound: [] as string[],
    };

    for (const email of emails) {
        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() },
        });

        if (!user) {
            results.notFound.push(email);
            continue;
        }

        // Check if already enrolled
        const existing = await prisma.enrollment.findUnique({
            where: {
                userId_courseId: {
                    userId: user.id,
                    courseId: courseId,
                },
            },
        });

        if (existing) {
            results.alreadyEnrolled.push(email);
            continue;
        }

        // Create enrollment
        await prisma.enrollment.create({
            data: {
                userId: user.id,
                courseId: courseId,
                status: 'enrolled',
                progress: 0,
            },
        });

        results.success.push(email);
    }

    revalidatePath(`/dashboard/training/courses/${courseId}`);
    return results;
}

/**
 * Get enrollment details with quiz results.
 * Used by the Quiz Results page.
 */
export async function getEnrollmentWithResults(enrollmentId: string) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: {
            user: {
                include: { profile: true },
            },
            course: {
                include: {
                    lessons: {
                        include: {
                            quiz: {
                                include: {
                                    questions: {
                                        orderBy: { order: 'asc' },
                                    },
                                },
                            },
                        },
                        orderBy: { order: 'asc' },
                    },
                },
            },
            quizAttempts: {
                include: {
                    quiz: {
                        include: {
                            questions: {
                                orderBy: { order: 'asc' },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!enrollment) {
        throw new Error('Enrollment not found');
    }

    // Verify access - either the enrolled user or the course creator
    const isEnrolledUser = enrollment.userId === session.user.id;
    const isCourseCreator = enrollment.course.createdBy === session.user.id;

    if (!isEnrolledUser && !isCourseCreator) {
        throw new Error('Access denied');
    }

    return enrollment;
}

/**
 * Submit a quiz attempt with answers.
 * Calculates score and updates enrollment.
 */
export async function submitQuizAttempt(
    enrollmentId: string,
    quizId: string,
    answers: { questionId: string; selectedAnswer: string }[],
    timeTaken?: number
) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    // Get enrollment and verify access
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
    });

    if (!enrollment || enrollment.userId !== session.user.id) {
        throw new Error('Enrollment not found');
    }

    // Get quiz with questions
    const quiz = await prisma.quiz.findUnique({
        where: { id: quizId },
        include: { questions: true },
    });

    if (!quiz) {
        throw new Error('Quiz not found');
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
                quizId,
            },
        },
    });

    if (existingAttempt) {
        // Update existing attempt
        await prisma.quizAttempt.update({
            where: { id: existingAttempt.id },
            data: {
                answers,
                score,
                timeTaken,
                completedAt: new Date(),
            },
        });
    } else {
        // Create new attempt
        await prisma.quizAttempt.create({
            data: {
                enrollmentId,
                quizId,
                answers,
                score,
                timeTaken,
            },
        });
    }

    // Update enrollment status and score
    await prisma.enrollment.update({
        where: { id: enrollmentId },
        data: {
            status: passed ? 'completed' : 'in_progress',
            score,
            completedAt: passed ? new Date() : null,
        },
    });

    revalidatePath(`/dashboard/training`);

    return {
        score,
        passed,
        correctCount,
        totalQuestions,
    };
}
