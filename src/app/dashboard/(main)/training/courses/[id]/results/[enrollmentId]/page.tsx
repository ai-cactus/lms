import React from 'react';
import QuizResults from '@/components/dashboard/training/QuizResults';
import { getEnrollmentWithResults } from '@/app/actions/enrollment';
import { notFound, redirect } from 'next/navigation';
import { requirePermission } from '@/lib/rbac/require-permission';
import { logger } from '@/lib/logger';
import { parseStoredOptionExplanations } from '@/lib/quiz/options';

export default async function QuizResultsPage({
  params,
}: {
  params: Promise<{ id: string; enrollmentId: string }>;
}) {
  const { id, enrollmentId } = await params;

  // Q26: the page-level module gate, mirroring the verb `getEnrollmentWithResults`
  // already resolves. It does NOT replace the data layer's own checks — that
  // action still enforces authorship, tenancy and facility scope, and still owns
  // the learner's own-attempt exemption (every worker role holds `assessment.read`
  // precisely so it can read its own sheet, so this guard does not close that).
  // What it adds is a refusal BEFORE the query for a role with no assessment
  // remit at all, in the uniform shape: "Page not found".
  await requirePermission('assessment.read', { onDeny: 'notFound' });

  try {
    const enrollment = await getEnrollmentWithResults(enrollmentId);

    const quizAttempts = enrollment.quizAttempts || [];
    const latestAttempt = quizAttempts[quizAttempts.length - 1];

    if (!latestAttempt) {
      // No quiz attempt yet - show empty state or redirect
      return (
        <div className="p-10 text-center">
          <h2>No Quiz Results</h2>
          <p>This user has not completed the quiz yet.</p>
        </div>
      );
    }

    const allQuestions = enrollment.course.lessons.flatMap(
      (lesson) => lesson.quiz?.questions || [],
    );

    const answers = latestAttempt.answers as { questionId: string; selectedAnswer: string }[];

    let correctCount = 0;
    let wrongCount = 0;

    allQuestions.forEach((q) => {
      const userAnswer = answers.find((a) => a.questionId === q.id);
      if (userAnswer?.selectedAnswer === q.correctAnswer) {
        correctCount++;
      } else {
        wrongCount++;
      }
    });

    const resultsData = {
      courseName: enrollment.course.title,
      score: latestAttempt.score,
      answered: allQuestions.length,
      correct: correctCount,
      wrong: wrongCount,
      time: latestAttempt.timeTaken ? Math.round(latestAttempt.timeTaken / 60) : 5,
      questions: allQuestions.map((q) => {
        const userAnswer = answers.find((a) => a.questionId === q.id);
        const rawOptions = Array.isArray(q.options) ? (q.options as string[]) : [];

        // Convert string[] to {id, text}[] and resolve selectedAnswer/correctAnswer to letter IDs
        const optionTexts = rawOptions.map((opt) => (typeof opt === 'string' ? opt : String(opt)));

        const selectedText = userAnswer?.selectedAnswer || '';
        const selectedIdx = optionTexts.findIndex((t) => t === selectedText);
        const selectedLetter = selectedIdx >= 0 ? String.fromCharCode(65 + selectedIdx) : '';

        const correctText = q.correctAnswer || '';
        const correctIdx = optionTexts.findIndex((t) => t === correctText);
        const correctLetter = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : '';

        const optionExplanations = parseStoredOptionExplanations(q.incorrectOptionExplanations);

        return {
          id: q.id,
          text: q.text,
          options: optionTexts.map((text, idx) => ({
            id: String.fromCharCode(65 + idx),
            text,
            explanation: optionExplanations?.[String(idx)],
          })),
          selectedAnswer: selectedLetter,
          correctAnswer: correctLetter,
          explanation: `The correct answer is ${correctLetter}. ${q.correctAnswer}`,
        };
      }),
      userName: enrollment.organizationUser.user.fullName || enrollment.organizationUser.user.email,
    };

    return (
      <QuizResults
        courseId={id}
        enrollmentId={enrollmentId}
        data={resultsData}
        passed={latestAttempt.score >= latestAttempt.quiz.passingScore}
        hideActions={true} // Hide redundant buttons in history view
        organizationName={enrollment.organizationUser.organization.name}
      />
    );
  } catch (error) {
    logger.error({ msg: 'Failed to load enrollment:', err: error });

    // Q26: both refusals collapse to "Page not found". They must be
    // INDISTINGUISHABLE — this URL carries an enrollment id, so an "Access
    // Denied" card confirmed that the id exists and belongs to someone, which is
    // exactly what the ruling is for. `Unauthorized` no longer reaches here: the
    // guard above sends an unauthenticated caller to /login.
    if (
      error instanceof Error &&
      (error.message === 'Access denied' || error.message === 'Enrollment not found')
    ) {
      notFound();
    }

    redirect(`/dashboard/training/courses/${id}`);
  }
}
