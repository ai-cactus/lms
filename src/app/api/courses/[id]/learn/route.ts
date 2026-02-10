import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET(
    request: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const courseId = params.id;

        // Get course with lessons and quiz
        const course = await prisma.course.findUnique({
            where: { id: courseId },
            include: {
                lessons: {
                    orderBy: { order: 'asc' },
                    include: {
                        quiz: {
                            include: {
                                questions: {
                                    orderBy: { order: 'asc' },
                                    select: {
                                        id: true,
                                        text: true,
                                        type: true,
                                        options: true,
                                        // Note: NOT including correctAnswer here for security
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!course) {
            return NextResponse.json({ error: 'Course not found' }, { status: 404 });
        }

        // Get user's enrollment
        const enrollment = await prisma.enrollment.findFirst({
            where: {
                courseId: courseId,
                userId: session.user.id
            },
            include: {
                quizAttempts: true
            }
        });

        if (!enrollment) {
            return NextResponse.json({ error: 'Not enrolled in this course' }, { status: 403 });
        }

        // Extract quiz from last lesson (where it's attached)
        const lastLesson = course.lessons[course.lessons.length - 1];
        const quiz = lastLesson?.quiz ? {
            id: lastLesson.quiz.id,
            title: lastLesson.quiz.title,
            passingScore: lastLesson.quiz.passingScore,
            questions: lastLesson.quiz.questions.map(q => ({
                id: q.id,
                text: q.text,
                type: q.type,
                options: Array.isArray(q.options) ? q.options : []
            }))
        } : null;

        // Get user details for attestation
        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            include: { profile: true }
        });

        return NextResponse.json({
            course: {
                id: course.id,
                title: course.title,
                description: course.description,
                lessons: course.lessons.map(l => ({
                    id: l.id,
                    title: l.title,
                    content: l.content,
                    duration: l.duration,
                    order: l.order
                })),
                quiz
            },
            enrollment: {
                id: enrollment.id,
                progress: enrollment.progress,
                status: enrollment.status,
                score: enrollment.score
            },
            user: {
                name: user?.profile?.fullName || user?.email || '',
                role: user?.profile?.jobTitle || 'Staff Member'
            }
        });

    } catch (error) {
        console.error('Error fetching course for learning:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
