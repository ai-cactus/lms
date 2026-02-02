'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function getStaffDetails(userId: string) {
    const session = await auth();
    if (!session?.user) {
        throw new Error('Unauthorized');
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                profile: true,
                enrollments: {
                    include: {
                        course: true,
                    },
                    orderBy: {
                        startedAt: 'desc',
                    }
                }
            }
        });

        if (!user) return null;

        // Calculate Stats
        const totalCourses = user.enrollments.length || 0;
        const completedCourses = user.enrollments.filter(e => e.status === 'completed').length || 0;

        // Assuming 'failed' status or score threshold. 
        // For now, let's assume if status is 'completed' and score < 70 (passing), it's a fail/retake needed.
        // Or if there's an explicit 'failed' status.
        // The previous code used score < 70 check for badges.
        const failedCourses = user.enrollments.filter(e =>
            e.status === 'completed' && (e.score !== null && e.score < 70)
        ).length || 0;

        const activeCourses = user.enrollments.filter(e => e.status === 'in_progress').length || 0;

        return {
            user: {
                id: user.id,
                name: user.profile?.fullName || user.email.split('@')[0],
                email: user.email,
                avatarUrl: user.profile?.avatarUrl ?? null,
                role: user.profile?.role || 'user',
                jobTitle: user.profile?.jobTitle || 'Staff Member',
            },
            stats: {
                totalCourses,
                completedCourses,
                failedCourses,
                activeCourses
            },
            enrollments: user.enrollments.map(e => ({
                id: e.id,
                courseId: e.courseId,
                courseName: e.course.title,
                courseImage: e.course.thumbnail,
                status: e.status,
                progress: e.progress,
                score: e.score,
                enrolledAt: e.startedAt,
                completedAt: e.completedAt,
                difficulty: e.course.difficulty,
            }))
        };
    } catch (error) {
        console.error('Failed to fetch staff details:', error);
        return null;
    }
}
