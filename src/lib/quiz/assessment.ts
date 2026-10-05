/**
 * The one quiz a learner sits for a course: the last lesson's quiz (reading
 * courses) or, failing that, the quiz attached to the course itself (video
 * courses).
 *
 * The learn player serves exactly this quiz and nothing else, so every rule
 * about "the course's quiz" — which quiz the player shows, which quiz a retake
 * counts attempts against, which quiz must be passed before attesting — has to
 * resolve it the same way, or a learner could be held to a quiz they are never
 * shown.
 *
 * `lessons` must be in lesson order (`order: 'asc'`), or be just the last
 * lesson.
 */
export function selectAssessmentQuiz<Q>(
  lessons: readonly { quiz: Q | null }[],
  courseQuiz: Q | null,
): Q | null {
  return lessons[lessons.length - 1]?.quiz ?? courseQuiz;
}
