import React from 'react';
import QuizResults from '@/components/dashboard/training/QuizResults';
import { getEnrollmentWithResults } from '@/app/actions/enrollment';
import { redirect } from 'next/navigation';

export default async function QuizResultsPage({ params }: { params: Promise<{ id: string; enrollmentId: string }> }) {
    const { id, enrollmentId } = await params;

    try {
        const enrollment = await getEnrollmentWithResults(enrollmentId);

        // Calculate stats from quiz attempts
        const quizAttempts = enrollment.quizAttempts || [];
        const latestAttempt = quizAttempts[quizAttempts.length - 1];

        if (!latestAttempt) {
            // No quiz attempt yet - show empty state or redirect
            return (
                <div style={{ padding: 40, textAlign: 'center' }}>
                    <h2>No Quiz Results</h2>
                    <p>This user has not completed the quiz yet.</p>
                </div>
            );
        }

        // Build the data for the component
        const allQuestions = enrollment.course.lessons.flatMap(
            lesson => lesson.quiz?.questions || []
        );

        // Parse answers from JSON
        const answers = latestAttempt.answers as { questionId: string; selectedAnswer: string }[];

        // Calculate correct/wrong counts
        let correctCount = 0;
        let wrongCount = 0;

        allQuestions.forEach(q => {
            const userAnswer = answers.find(a => a.questionId === q.id);
            if (userAnswer?.selectedAnswer === q.correctAnswer) {
                correctCount++;
            } else {
                wrongCount++;
            }
        });

        // Build props for the component
        const resultsData = {
            courseName: enrollment.course.title,
            score: latestAttempt.score,
            answered: allQuestions.length,
            correct: correctCount,
            wrong: wrongCount,
            time: latestAttempt.timeTaken ? Math.round(latestAttempt.timeTaken / 60) : 5,
            questions: allQuestions.map(q => {
                const userAnswer = answers.find(a => a.questionId === q.id);
                const options = (q.options as { id: string; text: string }[]) || [];
                return {
                    id: q.id,
                    text: q.text,
                    options: options,
                    selectedAnswer: userAnswer?.selectedAnswer || '',
                    correctAnswer: q.correctAnswer,
                    explanation: `The correct answer is ${q.correctAnswer}.`
                };
            }),
            userName: enrollment.user.profile?.fullName || enrollment.user.email,
        };

        return (
            <QuizResults
                courseId={id}
                enrollmentId={enrollmentId}
                data={resultsData}
            />
        );
    } catch (error) {
        console.error('Failed to load enrollment:', error);
        // If it's an access/auth error, show a message instead of redirect
        if (error instanceof Error) {
            if (error.message === 'Unauthorized') {
                return (
                    <div style={{ padding: 40, textAlign: 'center' }}>
                        <h2>Please Log In</h2>
                        <p>You need to be logged in to view quiz results.</p>
                    </div>
                );
            }
            if (error.message === 'Access denied') {
                return (
                    <div style={{ padding: 40, textAlign: 'center' }}>
                        <h2>Access Denied</h2>
                        <p>You don&apos;t have permission to view these results.</p>
                    </div>
                );
            }
            if (error.message === 'Enrollment not found') {
                return (
                    <div style={{ padding: 40, textAlign: 'center' }}>
                        <h2>Not Found</h2>
                        <p>This enrollment could not be found.</p>
                    </div>
                );
            }
        }
        redirect(`/dashboard/training/courses/${id}`);
    }
}
