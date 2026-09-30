import { passingScoreFor, resolvePassingScores } from '@/lib/dashboard/metrics';

type QuizBar = { passingScore: number } | null;

/**
 * A loaded course's passing bar, by the dashboards' definition: the strictest
 * `passingScore` across its course-level and lesson-level quizzes, or the
 * default when it has none. Reads what the course-detail payload already
 * carries, so the roster's Passed/Failed agrees with the dashboards without a
 * second query.
 */
export function coursePassingScore(course: {
  id: string;
  quiz: QuizBar;
  lessons: { quiz: QuizBar }[];
}): number {
  const quizzes = [course.quiz, ...course.lessons.map((lesson) => lesson.quiz)].flatMap((quiz) =>
    quiz ? [{ passingScore: quiz.passingScore, courseId: course.id }] : [],
  );
  return passingScoreFor(resolvePassingScores(quizzes), course.id);
}
