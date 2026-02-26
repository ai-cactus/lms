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

        // Check if user is admin
        const isAdmin = session.user.role === 'admin' || session.user.role === 'superadmin' || session.user.role === 'organization_admin';

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

        if (!enrollment && !isAdmin) {
            return NextResponse.json({ error: 'Not enrolled in this course' }, { status: 403 });
        }

        // Mock enrollment for admins if none exists
        const effectiveEnrollment = enrollment || {
            id: 'preview-mode',
            progress: 0,
            status: 'in_progress',
            score: null,
            quizAttempts: []
        };

        // Extract quiz from last lesson (where it's attached)
        const lastLesson = course.lessons[course.lessons.length - 1];
        const quizData = lastLesson?.quiz as any;

        const quiz = quizData ? {
            id: quizData.id,
            title: quizData.title,
            passingScore: quizData.passingScore,
            allowedAttempts: quizData.allowedAttempts,
            timeLimit: quizData.timeLimit,
            questions: quizData.questions.map((q: any) => ({
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

        // Build detailed quiz results if the user has completed the quiz
        let quizResultsData = null;
        const latestAttempt = effectiveEnrollment.quizAttempts?.length > 0
            ? (effectiveEnrollment.quizAttempts as any[]).sort((a: any, b: any) =>
                new Date(b.completedAt || b.createdAt).getTime() - new Date(a.completedAt || a.createdAt).getTime()
            )[0]
            : null;

        if (latestAttempt && quizData) {
            // Fetch quiz with correct answers for results
            const quizWithAnswers = await prisma.quiz.findUnique({
                where: { id: quizData.id },
                include: { questions: { orderBy: { order: 'asc' } } }
            });

            if (quizWithAnswers) {
                const attemptAnswers = Array.isArray(latestAttempt.answers) ? latestAttempt.answers as any[] : [];
                const totalQ = quizWithAnswers.questions.length;
                const correctCount = attemptAnswers.filter((a: any) => {
                    const question = quizWithAnswers.questions.find(q => q.id === a.questionId);
                    return question && question.correctAnswer === a.selectedAnswer;
                }).length;

                quizResultsData = {
                    score: latestAttempt.score || 0,
                    passed: (latestAttempt.score || 0) >= (quizData.passingScore || 70),
                    correctCount,
                    totalQuestions: totalQ,
                    answered: attemptAnswers.length,
                    correct: correctCount,
                    wrong: attemptAnswers.length - correctCount,
                    time: latestAttempt.timeTaken || 0,
                    questions: quizWithAnswers.questions.map((q: any) => {
                        const userAnswer = attemptAnswers.find((a: any) => a.questionId === q.id);
                        const optionsArray = Array.isArray(q.options) ? q.options : [];
                        const optionTexts = optionsArray.map((opt: any) => typeof opt === 'string' ? opt : opt.text || opt);

                        const selectedText = userAnswer?.selectedAnswer || '';
                        const selectedIdx = optionTexts.findIndex((t: string) => t === selectedText);
                        const selectedLetter = selectedIdx >= 0 ? String.fromCharCode(65 + selectedIdx) : '';

                        const correctText = q.correctAnswer || '';
                        const correctIdx = optionTexts.findIndex((t: string) => t === correctText);
                        const correctLetter = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : '';

                        return {
                            id: q.id,
                            text: q.text,
                            options: optionsArray.map((opt: any, idx: number) => ({
                                id: String.fromCharCode(65 + idx),
                                text: typeof opt === 'string' ? opt : opt.text || opt
                            })),
                            selectedAnswer: selectedLetter,
                            correctAnswer: correctLetter,
                            explanation: userAnswer?.explanation || ''
                        };
                    })
                };
            }
        }

        return NextResponse.json({
            course: {
                id: course.id,
                title: course.title,
                description: course.description,
                duration: course.duration,
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
                id: effectiveEnrollment.id,
                progress: effectiveEnrollment.progress,
                status: effectiveEnrollment.status,
                score: effectiveEnrollment.score,
                quizAttempts: effectiveEnrollment.quizAttempts
            },
            quizResultsData,
            user: {
                name: user?.profile?.fullName || user?.email || '',
                role: user?.role || 'worker'
            }
        });

    } catch (error) {
        console.error('Error fetching course for learning:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
