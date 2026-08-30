/**
 * Represents a single staff member to be enrolled in a course.
 * Sourced either from manual email input or from a CSV upload
 * containing First Name, Last Name, Role, and Email columns.
 */
export interface StaffEntry {
  email: string;
  firstName?: string;
  lastName?: string;
  /** Defaults to 'worker' when omitted or unrecognised. */
  role?: 'admin' | 'worker';
}

/** The quiz-attempt fields a learner course row reads. Newest attempt first. */
export interface LearnerCourseAttempt {
  id: string;
  attemptCount: number;
  /** Null while the attempt is still an open draft — only a completed attempt has a verdict. */
  timeTaken: number | null;
  score: number;
}

/**
 * One row in a learner-facing course list. Shared by `WorkerCourseList` and
 * `WorkerTrainingList` so the two cannot drift: they previously declared
 * near-identical private interfaces, and the trainings one was missing
 * `passingScore` and the attempt `score` that the pass/fail derivation needs.
 */
export interface LearnerCourseRow {
  /** Course id — the row key for navigation. */
  id: string;
  title: string;
  category?: string | null;
  status: string;
  progress: number;
  deadline?: Date | string | null;
  duration?: number;
  quizAttempts?: LearnerCourseAttempt[];
  passingScore?: number | null;
  /** Set when this enrollment is an admin-assigned retake of an earlier one. */
  retakeOf?: string | null;
  enrollmentId?: string;
  /** Present once a certificate has been issued for this enrollment. */
  certificateId?: string | null;
}
