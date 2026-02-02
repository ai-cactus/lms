'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';

export type CourseWithStats = {
    id: string;
    title: string;
    description: string | null;
    thumbnail: string | null;
    difficulty: string;
    status: string;
    category: string | null;
    duration: number | null;
    createdAt: Date;
    updatedAt: Date;
    lessonsCount: number;
    enrollmentsCount: number;
    completionRate: number;
};

// Get all courses for current user (admin)
export async function getCourses(): Promise<CourseWithStats[]> {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const courses = await prisma.course.findMany({
        where: { createdBy: session.user.id },
        include: {
            lessons: { select: { id: true } },
            enrollments: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    return courses.map((course) => ({
        id: course.id,
        title: course.title,
        description: course.description,
        thumbnail: course.thumbnail,
        difficulty: course.difficulty,
        status: course.status,
        category: course.category,
        duration: course.duration,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        lessonsCount: course.lessons.length,
        enrollmentsCount: course.enrollments.length,
        completionRate:
            course.enrollments.length > 0
                ? Math.round(
                    (course.enrollments.filter((e) => e.status === 'completed').length /
                        course.enrollments.length) *
                    100
                )
                : 0,
    }));
}

// Get single course by ID with lessons
export async function getCourseById(courseId: string) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: {
            lessons: {
                orderBy: { order: 'asc' },
                include: {
                    quiz: {
                        include: { questions: { orderBy: { order: 'asc' } } },
                    },
                },
            },
            enrollments: {
                include: { user: { include: { profile: true } } },
            },
            creator: {
                include: { profile: true }
            }
        },
    });

    if (!course || course.createdBy !== session.user.id) {
        throw new Error('Course not found');
    }

    return course;
}

// Create a new course
export async function createCourse(data: {
    title: string;
    description?: string;
    category?: string;
    difficulty?: string;
}) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const course = await prisma.course.create({
        data: {
            title: data.title,
            description: data.description || null,
            category: data.category || null,
            difficulty: data.difficulty || 'beginner',
            createdBy: session.user.id,
        },
    });

    revalidatePath('/dashboard/training');
    return course;
}

// Update course details
export async function updateCourse(
    courseId: string,
    data: {
        title?: string;
        description?: string;
        thumbnail?: string;
        difficulty?: string;
        category?: string;
        duration?: number;
    }
) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    // Verify ownership
    const existing = await prisma.course.findUnique({ where: { id: courseId } });
    if (!existing || existing.createdBy !== session.user.id) {
        throw new Error('Course not found');
    }

    const course = await prisma.course.update({
        where: { id: courseId },
        data,
    });

    revalidatePath('/dashboard/training');
    revalidatePath(`/dashboard/training/${courseId}`);
    return course;
}

// Publish a course
export async function publishCourse(courseId: string) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const existing = await prisma.course.findUnique({ where: { id: courseId } });
    if (!existing || existing.createdBy !== session.user.id) {
        throw new Error('Course not found');
    }

    const course = await prisma.course.update({
        where: { id: courseId },
        data: { status: 'published' },
    });

    revalidatePath('/dashboard/training');
    return course;
}

// Delete a course
export async function deleteCourse(courseId: string) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const existing = await prisma.course.findUnique({ where: { id: courseId } });
    if (!existing || existing.createdBy !== session.user.id) {
        throw new Error('Course not found');
    }

    await prisma.course.delete({ where: { id: courseId } });

    revalidatePath('/dashboard/training');
    return { success: true };
}

// Get dashboard statistics
export async function getDashboardStats() {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const [courses, enrollments] = await Promise.all([
        prisma.course.findMany({
            where: { createdBy: session.user.id },
            include: { enrollments: true },
        }),
        prisma.enrollment.findMany({
            where: { course: { createdBy: session.user.id } },
        }),
    ]);

    const totalCourses = courses.length;
    const totalStaffAssigned = new Set(enrollments.map((e) => e.userId)).size;
    const completedEnrollments = enrollments.filter(
        (e) => e.status === 'completed'
    );
    const averageScore =
        completedEnrollments.length > 0
            ? Math.round(
                completedEnrollments.reduce((sum, e) => sum + (e.score || 0), 0) /
                completedEnrollments.length
            )
            : 0;

    // Calculate monthly performance (average score per month for last 12 months)
    const monthlyPerformance = Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - (11 - i));
        return {
            month: d.toLocaleString('default', { month: 'short' }),
            monthIdx: d.getMonth(),
            year: d.getFullYear(),
        };
    }).map(({ month, monthIdx, year }) => {
        const inMonth = completedEnrollments.filter((e) => {
            if (!e.completedAt) return false;
            const c = new Date(e.completedAt);
            return c.getMonth() === monthIdx && c.getFullYear() === year;
        });

        const avg =
            inMonth.length > 0
                ? Math.round(inMonth.reduce((sum, e) => sum + (e.score || 0), 0) / inMonth.length)
                : 0;

        return { month, value: avg };
    });

    const completedCount = enrollments.filter(
        (e) => e.status === 'completed'
    ).length;
    const inProgressCount = enrollments.filter(
        (e) => e.status === 'in_progress'
    ).length;
    const enrolledCount = enrollments.filter(
        (e) => e.status === 'enrolled'
    ).length;
    const totalEnrollments = enrollments.length;

    return {
        totalCourses,
        totalStaffAssigned,
        averageGrade: averageScore,
        monthlyPerformance,
        trainingCoverage: {
            completed:
                totalEnrollments > 0
                    ? Math.round((completedCount / totalEnrollments) * 100)
                    : 0,
            inProgress:
                totalEnrollments > 0
                    ? Math.round((inProgressCount / totalEnrollments) * 100)
                    : 0,
            notStarted:
                totalEnrollments > 0
                    ? Math.round((enrolledCount / totalEnrollments) * 100)
                    : 0,
        },
    };
}
