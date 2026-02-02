'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';

// Create a new lesson
export async function createLesson(data: {
    courseId: string;
    title: string;
    content: string;
    duration?: number;
}) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    // Verify course ownership
    const course = await prisma.course.findUnique({
        where: { id: data.courseId },
        include: { lessons: { select: { order: true } } },
    });
    if (!course || course.createdBy !== session.user.id) {
        throw new Error('Course not found');
    }

    // Get next order number
    const maxOrder = course.lessons.reduce(
        (max, l) => Math.max(max, l.order),
        0
    );

    const lesson = await prisma.lesson.create({
        data: {
            courseId: data.courseId,
            title: data.title,
            content: data.content,
            duration: data.duration || null,
            order: maxOrder + 1,
        },
    });

    revalidatePath(`/dashboard/training/${data.courseId}`);
    return lesson;
}

// Update lesson content
export async function updateLesson(
    lessonId: string,
    data: {
        title?: string;
        content?: string;
        duration?: number;
    }
) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    // Verify ownership through course
    const existing = await prisma.lesson.findUnique({
        where: { id: lessonId },
        include: { course: true },
    });
    if (!existing || existing.course.createdBy !== session.user.id) {
        throw new Error('Lesson not found');
    }

    const lesson = await prisma.lesson.update({
        where: { id: lessonId },
        data,
    });

    revalidatePath(`/dashboard/training/${existing.courseId}`);
    return lesson;
}

// Delete a lesson
export async function deleteLesson(lessonId: string) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const existing = await prisma.lesson.findUnique({
        where: { id: lessonId },
        include: { course: true },
    });
    if (!existing || existing.course.createdBy !== session.user.id) {
        throw new Error('Lesson not found');
    }

    await prisma.lesson.delete({ where: { id: lessonId } });

    // Reorder remaining lessons
    const remainingLessons = await prisma.lesson.findMany({
        where: { courseId: existing.courseId },
        orderBy: { order: 'asc' },
    });

    for (let i = 0; i < remainingLessons.length; i++) {
        await prisma.lesson.update({
            where: { id: remainingLessons[i].id },
            data: { order: i + 1 },
        });
    }

    revalidatePath(`/dashboard/training/${existing.courseId}`);
    return { success: true };
}

// Reorder lessons
export async function reorderLessons(
    courseId: string,
    lessonOrder: { id: string; order: number }[]
) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.createdBy !== session.user.id) {
        throw new Error('Course not found');
    }

    await prisma.$transaction(
        lessonOrder.map((item) =>
            prisma.lesson.update({
                where: { id: item.id },
                data: { order: item.order },
            })
        )
    );

    revalidatePath(`/dashboard/training/${courseId}`);
    return { success: true };
}

// Create lesson with quiz (bulk)
export async function createLessonWithQuiz(data: {
    courseId: string;
    title: string;
    content: string;
    duration?: number;
    quiz?: {
        title: string;
        passingScore?: number;
        questions: {
            text: string;
            type: string;
            options?: string[];
            correctAnswer: string;
        }[];
    };
}) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const course = await prisma.course.findUnique({
        where: { id: data.courseId },
        include: { lessons: { select: { order: true } } },
    });
    if (!course || course.createdBy !== session.user.id) {
        throw new Error('Course not found');
    }

    const maxOrder = course.lessons.reduce(
        (max, l) => Math.max(max, l.order),
        0
    );

    const lesson = await prisma.lesson.create({
        data: {
            courseId: data.courseId,
            title: data.title,
            content: data.content,
            duration: data.duration || null,
            order: maxOrder + 1,
            quiz: data.quiz
                ? {
                    create: {
                        title: data.quiz.title,
                        passingScore: data.quiz.passingScore || 70,
                        questions: {
                            create: data.quiz.questions.map((q, i) => ({
                                text: q.text,
                                type: q.type,
                                options: q.options ? q.options : Prisma.DbNull,
                                correctAnswer: q.correctAnswer,
                                order: i + 1,
                            })),
                        },
                    },
                }
                : undefined,
        },
        include: { quiz: { include: { questions: true } } },
    });

    revalidatePath(`/dashboard/training/${data.courseId}`);
    return lesson;
}
