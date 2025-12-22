import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { QuizResultsPDF } from '@/components/pdf/QuizResultsPDF';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ assignmentId: string }> }
) {
    try {
        const { assignmentId } = await params;
        const supabase = await createClient();

        // Get authenticated user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get assignment details
        const { data: assignmentData, error: assignmentError } = await supabase
            .from('course_assignments')
            .select(`
                id,
                status,
                course:courses(
                    id,
                    title,
                    quiz_questions(*)
                )
            `)
            .eq('id', assignmentId)
            .eq('worker_id', user.id)
            .single();

        if (assignmentError || !assignmentData) {
            return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
        }

        // Get the latest quiz attempt
        const { data: attempt, error: attemptError } = await supabase
            .from('quiz_attempts')
            .select('*')
            .eq('assignment_id', assignmentId)
            .order('completed_at', { ascending: false })
            .limit(1)
            .single();

        if (attemptError || !attempt) {
            return NextResponse.json({ error: 'No quiz attempt found' }, { status: 404 });
        }

        // Get answers for this attempt
        const { data: answers, error: answersError } = await supabase
            .from('quiz_answers')
            .select('question_id, selected_option_text')
            .eq('attempt_id', attempt.id);

        // Get user profile
        const { data: userProfile } = await supabase
            .from('users')
            .select('full_name')
            .eq('id', user.id)
            .single();

        // Prepare questions data with answers
        const questions = assignmentData.course.quiz_questions.map((q: any) => {
            const userAnswer = answers?.find((a: any) => a.question_id === q.id);
            const selectedAnswer = userAnswer?.selected_option_text;
            const isCorrect = q.question_type === 'short_answer'
                ? (selectedAnswer || "").toLowerCase().trim() === (q.correct_answer || "").toLowerCase().trim()
                : selectedAnswer === q.correct_answer;

            return {
                id: q.id,
                question_text: q.question_text,
                options: q.options,
                correct_answer: q.correct_answer,
                explanation: q.explanation,
                selectedAnswer,
                isCorrect,
            };
        });

        // Generate PDF
        const pdfBuffer = await renderToBuffer(
            <QuizResultsPDF
                courseTitle={assignmentData.course.title}
                workerName={userProfile?.full_name || 'Worker'}
                completedAt={attempt.completed_at}
                score={attempt.score}
                passed={attempt.passed}
                questions={questions}
            />
        );

        // Return PDF as response
        return new NextResponse(pdfBuffer, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="quiz-results-${assignmentData.course.title.replace(/\s+/g, '-').toLowerCase()}.pdf"`,
            },
        });

    } catch (error) {
        console.error('Error generating quiz results PDF:', error);
        return NextResponse.json(
            { error: 'Failed to generate PDF' },
            { status: 500 }
        );
    }
}
