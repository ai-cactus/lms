'use client';

import React, { useState, useEffect } from 'react';
import { isAdminRole, isWorkerRole } from '@/lib/rbac/role-utils';
import { useParams, useRouter } from 'next/navigation';
import { Menu, AlertCircle } from 'lucide-react';
import QuizResults from '@/components/dashboard/training/QuizResults';

// Reusable Components
import CourseRail from '@/components/courses/CourseRail';
import CourseSlide from '@/components/courses/CourseSlide';
import CourseArticle from '@/components/courses/CourseArticle';
import AdminQuizEditor from '@/components/courses/AdminQuizEditor';
import AdminLessonEditor from '@/components/courses/AdminLessonEditor';
import AdminCourseReview from '@/components/courses/AdminCourseReview';
import { Button } from '@/components/ui/button';
import { VideoPlayer } from '@/components/video/VideoPlayer';
import { isQuizUnlocked } from '@/lib/video/gating';
import { sanitizeHtml } from '@/lib/sanitize';
import { logger } from '@/lib/logger';

interface Lesson {
  id: string;
  title: string;
  content: string;
  slideContent?: string;
  duration: number | null;
  order: number;
  moduleIndex: number;
  videoProvider?: string | null;
  videoStorageUri?: string | null;
  videoDurationSeconds?: number | null;
}

interface Question {
  id: string;
  text: string;
  type: string;
  options: string[];
  correctAnswer: string;
  explanation?: string;
}

interface Quiz {
  id: string;
  title: string;
  passingScore: number;
  allowedAttempts: number | null;
  timeLimit: number | null;
  questions: Question[];
  difficulty?: string;
}

interface CourseData {
  id: string;
  title: string;
  description: string;
  duration: number | null;
  lessons: Lesson[];
  quiz?: Quiz;
}

interface EnrollmentData {
  id: string;
  progress: number;
  status: string;
  score?: number;
  videoPositionSeconds?: number | null;
  quizAttempts?: {
    id: string;
    score: number;
    attemptCount: number;
    completedAt: string | Date;
    timeTaken: number | null;
    answers?: { questionId: string; selectedAnswer: string; explanation?: string }[];
  }[];
}

interface QuizQuestionResult {
  id: string;
  text: string;
  options: { id: string; text: string }[];
  selectedAnswer: string;
  correctAnswer: string;
  explanation: string;
}

interface QuizResultsData {
  passed: boolean;
  score: number;
  totalQuestions: number;
  correctCount: number;
  answered: number;
  correct: number;
  wrong: number;
  time: number;
  questions: QuizQuestionResult[];
  attemptsUsed?: number;
  allowedAttempts?: number | null;
}

interface UserData {
  name: string;
  role: string;
  organizationName?: string;
  email: string;
  jobTitle: string;
}

export default function LearnPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.id as string;

  // Data State
  const [course, setCourse] = useState<CourseData | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // View State
  const [viewMode, setViewMode] = useState<'slides' | 'article'>('article');
  const [activeIndex, setActiveIndex] = useState(0);

  // Linear progression
  const [highestUnlockedIndex, setHighestUnlockedIndex] = useState(0);

  // Quiz State
  const [isQuizActive, setIsQuizActive] = useState(false);
  const [quizStep, setQuizStep] = useState<'intro' | 'active' | 'results' | 'review'>('intro');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [quizResults, setQuizResults] = useState<QuizResultsData | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Modal State
  const [showQuizGateModal, setShowQuizGateModal] = useState(false);
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);

  // Mobile Rail Toggle
  const [railOpen, setRailOpen] = useState(false);

  // Quiz unlocked flag
  const [quizUnlocked, setQuizUnlocked] = useState(false);

  // Video watch-gate progress (only relevant for VIDEO lessons).
  // Seeded in the initial fetch from the video's own position
  // (videoPositionSeconds / videoDurationSeconds), then updated live by VideoPlayer.
  const [watchedPct, setWatchedPct] = useState(0);

  // Track if user just finished quiz in this session
  // (Removed unused justFinished state)

  const updateProgress = async (idx: number) => {
    if (!course || !enrollment) return;
    if (enrollment.id === 'preview-mode') return;
    if (idx >= course.lessons.length) return;

    const progress = Math.round(((idx + 1) / course.lessons.length) * 100);
    if (progress > (enrollment.progress || 0)) {
      try {
        await fetch(`/api/enrollments/${enrollment.id}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ progress }),
        });
        setEnrollment((prev) => (prev ? { ...prev, progress } : prev));
      } catch (err) {
        logger.error({ msg: 'Failed to update progress', err: err });
      }
    }
  };

  const handleSubmitQuiz = React.useCallback(async () => {
    if (!course?.quiz || !enrollment) return;
    setSubmitting(true);
    const answers = Object.entries(quizAnswers).map(([qId, val]) => ({
      questionId: qId,
      selectedAnswer: val,
    }));

    const limit = course?.quiz?.timeLimit
      ? course.quiz.timeLimit * 60
      : (course?.quiz?.questions.length || 5) * 60;
    const timeTaken = Math.max(0, limit - timeLeft);

    try {
      const res = await fetch(`/api/quiz/${course.quiz.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollmentId: enrollment.id,
          answers,
          timeTaken: timeTaken,
        }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      const result = await res.json();
      setQuizResults(result);
      setQuizStep('review');
    } catch (err) {
      logger.error({ msg: 'Error:', err: err });
      alert('Failed to submit quiz');
    } finally {
      setSubmitting(false);
    }
  }, [course, enrollment, quizAnswers, timeLeft]);

  const handleNextQuestion = () => {
    if (!course?.quiz) return;
    if (currentQuestionIndex < course.quiz.questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    } else {
      handleSubmitQuiz();
    }
  };

  // True when the LAST lesson is a video lesson whose watch-gate has not yet been met.
  // Admins bypass; non-video courses are unaffected (returns false).
  const isVideoQuizGateBlocked = () => {
    if (!course || isAdminRole(userData?.role)) return false;
    const lastLesson = course.lessons[course.lessons.length - 1];
    if (!lastLesson?.videoStorageUri) return false;
    return !isQuizUnlocked(watchedPct);
  };

  const handleRailSelect = (index: number) => {
    if (!course) return;

    // Quiz Index Selection
    if (index === course.lessons.length) {
      // Video watch-gate: keep the quiz locked until the gate is met.
      // (The disabled control + hint already communicate this to the learner.)
      if (!quizResults && isVideoQuizGateBlocked()) {
        return;
      }
      if (quizUnlocked || quizResults || isAdminRole(userData?.role)) {
        setIsQuizActive(true);
        setQuizStep(quizResults ? 'review' : 'intro');
        setActiveIndex(index);
      } else if (highestUnlockedIndex >= course.lessons.length - 1) {
        setShowQuizGateModal(true);
      } else {
        setShowIncompleteModal(true);
      }
      return;
    }

    // Standard Lesson Selection
    if (index <= highestUnlockedIndex || isAdminRole(userData?.role)) {
      setIsQuizActive(false);
      setActiveIndex(index);
    }
  };

  const handleNext = () => {
    if (!course) return;

    if (activeIndex < course.lessons.length - 1) {
      const nextIndex = activeIndex + 1;
      if (nextIndex > highestUnlockedIndex) {
        setHighestUnlockedIndex(nextIndex);
      }
      setIsQuizActive(false);
      setActiveIndex(nextIndex);
      updateProgress(nextIndex);
    } else if (activeIndex === course.lessons.length - 1 && course.quiz) {
      // Reached end of lessons, check quiz.
      // Video watch-gate: bail out BEFORE writing any progress so a blocked video
      // lesson never persists a lesson-completion value that would later seed/unlock
      // the gate on reload. Text courses (gate returns false) fall through unchanged.
      if (isVideoQuizGateBlocked()) {
        return;
      }

      if (course.lessons.length - 1 > highestUnlockedIndex) {
        setHighestUnlockedIndex(course.lessons.length - 1);
      }
      updateProgress(course.lessons.length - 1);

      if (quizUnlocked || isAdminRole(userData?.role)) {
        setIsQuizActive(true);
        setQuizStep(quizResults ? 'review' : 'intro');
        setActiveIndex(course.lessons.length);
      } else {
        setShowQuizGateModal(true);
      }
    }
  };

  const handlePrev = () => {
    if (activeIndex > 0) {
      setIsQuizActive(false);
      setActiveIndex(activeIndex - 1);
    }
  };

  const handleConfirmQuiz = () => {
    setShowQuizGateModal(false);
    setQuizUnlocked(true);
    setIsQuizActive(true);
    setQuizStep('intro');
    setActiveIndex(course!.lessons.length);
  };

  const handleStartQuiz = async () => {
    if (!course?.quiz || !enrollment) return;

    try {
      await fetch(`/api/quiz/${course.quiz.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId: enrollment.id }),
      });

      setQuizStep('active');
      setCurrentQuestionIndex(0);
      setQuizAnswers({});
      const limit = course?.quiz?.timeLimit
        ? course.quiz.timeLimit * 60
        : (course?.quiz?.questions.length || 5) * 60;
      setTimeLeft(limit);
    } catch (err) {
      logger.error({ msg: 'Failed to start quiz', err: err });
      alert('Failed to start quiz session. Please try again.');
    }
  };

  const handleOptionSelect = async (option: string) => {
    if (!course?.quiz || !enrollment) return;
    const questionId = course.quiz.questions[currentQuestionIndex].id;

    // Update local state immediately for UI responsiveness
    const newAnswers = { ...quizAnswers, [questionId]: option };
    setQuizAnswers(newAnswers);

    try {
      // Convert to array format for backend
      const answersArray = Object.entries(newAnswers).map(([qId, val]) => ({
        questionId: qId,
        selectedAnswer: val,
      }));

      await fetch(`/api/quiz/${course.quiz.id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollmentId: enrollment.id,
          answers: answersArray,
        }),
      });
    } catch (err) {
      logger.error({ msg: 'Failed to save progress', err: err });
    }
  };

  // Initial Fetch
  useEffect(() => {
    const fetchCourseData = async () => {
      try {
        const res = await fetch(`/api/courses/${params.id}/learn`);
        if (!res.ok) throw new Error('Failed to load course');
        const data = (await res.json()) as {
          course: CourseData;
          enrollment: EnrollmentData;
          user: UserData & { organizationName?: string };
          quizResultsData?: QuizResultsData;
        };

        if (data.course.lessons) {
          data.course.lessons = data.course.lessons.map((l: Lesson, i: number) => ({
            ...l,
            moduleIndex: i,
          }));
        }

        setCourse(data.course);
        setEnrollment(data.enrollment);
        setUserData(data.user);

        // Seed the video watch-gate from the VIDEO's own authoritative signal
        // (videoPositionSeconds / videoDurationSeconds), NOT enrollment.progress.
        // enrollment.progress is also written by lesson-nav (updateProgress) and would
        // otherwise unlock the gate after a reload even if the video was never watched.
        const videoLesson = (data.course.lessons || []).find((l) => l.videoStorageUri);
        if (videoLesson) {
          const durationSeconds = videoLesson.videoDurationSeconds ?? 0;
          const positionSeconds = data.enrollment?.videoPositionSeconds ?? 0;
          const seededPct =
            durationSeconds > 0
              ? Math.min(100, Math.round((positionSeconds / durationSeconds) * 100))
              : 0;
          setWatchedPct(seededPct);
        }

        const lessonCount = data.course.lessons?.length || 1;

        // Restore state from backend progress
        const activeAttempt = data.enrollment?.quizAttempts?.find(
          (a: { timeTaken: number | null }) => a.timeTaken === null,
        );

        const hasQuizAttempt = (data.enrollment?.quizAttempts?.length ?? 0) > 0;
        const isCompleted =
          data.enrollment?.status === 'completed' || data.enrollment?.status === 'attested';

        if (activeAttempt) {
          // RESTORE ACTIVE SESSION
          setQuizUnlocked(true);
          setHighestUnlockedIndex(lessonCount - 1);
          setActiveIndex(lessonCount);
          setIsQuizActive(true);
          setQuizStep('active');

          const savedAnswers: Record<string, string> = {};
          if (Array.isArray(activeAttempt.answers)) {
            activeAttempt.answers.forEach((ans: { questionId: string; selectedAnswer: string }) => {
              savedAnswers[ans.questionId] = ans.selectedAnswer;
            });
          }
          setQuizAnswers(savedAnswers);

          const startedAt = new Date(activeAttempt.completedAt).getTime();
          const now = new Date().getTime();
          const elapsedSeconds = Math.floor((now - startedAt) / 1000);

          const limit = data.course.quiz?.timeLimit
            ? data.course.quiz.timeLimit * 60
            : (data.course.quiz?.questions.length || 5) * 60;

          const remaining = Math.max(0, limit - elapsedSeconds);
          setTimeLeft(remaining);
        } else if (isCompleted) {
          // Completed/attested: show course content by default, quiz results accessible via rail
          const resultsData: QuizResultsData = data.quizResultsData || {
            passed: (data.enrollment.score || 0) >= (data.course.quiz?.passingScore || 70),
            score: data.enrollment.score || 0,
            totalQuestions: 0,
            correctCount: 0,
            answered: 0,
            correct: 0,
            wrong: 0,
            time: 0,
            questions: [],
          };
          setQuizResults(resultsData);
          // Default to first lesson so workers can review course content
          setActiveIndex(0);
          setIsQuizActive(false);
          setQuizUnlocked(true);
          setHighestUnlockedIndex(lessonCount - 1);
        } else if (
          data.enrollment?.status === 'locked' ||
          (hasQuizAttempt && !activeAttempt && data.enrollment?.score != null)
        ) {
          // Locked or has a submitted (scored) quiz not yet completed/attested: show quiz review.
          // Gate on score != null so a retaken enrollment (score reset to null) is NOT trapped
          // here — the review screen is only for submitted attempts.
          const resultsData: QuizResultsData = data.quizResultsData || {
            passed: (data.enrollment.score || 0) >= (data.course.quiz?.passingScore || 70),
            score: data.enrollment.score || 0,
            totalQuestions: 0,
            correctCount: 0,
            answered: 0,
            correct: 0,
            wrong: 0,
            time: 0,
            questions: [],
          };
          setQuizResults(resultsData);
          if (data.course.lessons) setActiveIndex(data.course.lessons.length);
          setIsQuizActive(true);
          setQuizStep('review');
          setQuizUnlocked(true);
          setHighestUnlockedIndex(lessonCount - 1);
        } else if (hasQuizAttempt && !activeAttempt) {
          // Retake pending: retakeQuiz() reset enrollment.score to null and left the completed
          // attempts immutable, creating no draft. Land on the quiz START screen (intro) so the
          // worker sees "Attempt N of M" + Start Quiz (which calls /start to append the new draft).
          setQuizUnlocked(true);
          setHighestUnlockedIndex(lessonCount - 1);
          setActiveIndex(lessonCount);
          setIsQuizActive(true);
          setQuizStep('intro');
        } else if (data.enrollment?.progress > 0) {
          const savedProgress = data.enrollment.progress;
          const restoredIndex = Math.min(
            Math.round((savedProgress / 100) * lessonCount) - 1,
            lessonCount - 1,
          );
          const startIndex = Math.max(0, restoredIndex);
          setActiveIndex(startIndex);
          setHighestUnlockedIndex(startIndex);

          if (savedProgress >= 100) {
            setQuizUnlocked(true);
            setHighestUnlockedIndex(lessonCount - 1);
          }
        } else {
          setHighestUnlockedIndex(0);
        }
      } catch (err: unknown) {
        const error = err as Error;
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };
    fetchCourseData();
  }, [params.id, router]);

  // Timer Effect
  useEffect(() => {
    if (isQuizActive && quizStep === 'active' && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            handleSubmitQuiz();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isQuizActive, quizStep, timeLeft, handleSubmitQuiz]);

  if (loading)
    return (
      <div className="flex flex-row-reverse max-md:flex-col h-screen w-full overflow-hidden bg-background-secondary font-sans text-[#1a1a1a] justify-center items-center">
        Loading...
      </div>
    );
  if (error)
    return (
      <div className="flex flex-row-reverse max-md:flex-col h-screen w-full overflow-hidden bg-background-secondary font-sans text-[#1a1a1a] justify-center items-center">
        Error: {error}
      </div>
    );
  if (!course) return null;

  // Admins opening a VIDEO course get a clean read-only review: the course
  // video + an answer-key walkthrough of the quiz + an Assign action. (Text
  // courses keep the existing editable admin flow below.)
  if (isAdminRole(userData?.role) && course.lessons.some((l) => l.videoStorageUri)) {
    const reviewVideoLesson = course.lessons.find((l) => l.videoStorageUri) ?? null;
    return (
      <AdminCourseReview
        courseId={courseId}
        title={course.title}
        videoLesson={
          reviewVideoLesson ? { id: reviewVideoLesson.id, title: reviewVideoLesson.title } : null
        }
        enrollmentId={enrollment?.id || 'preview-mode'}
        quiz={
          course.quiz
            ? {
                title: course.quiz.title,
                passingScore: course.quiz.passingScore,
                questions: course.quiz.questions.map((q) => ({
                  id: q.id,
                  text: q.text,
                  options: q.options,
                  correctAnswer: q.correctAnswer,
                  explanation: q.explanation,
                })),
              }
            : null
        }
      />
    );
  }

  const isQuizIndex = activeIndex >= course.lessons.length;
  const currentLesson = !isQuizIndex ? course.lessons[activeIndex] : null;

  // VIDEO lesson detection + watch-gate. Text lessons (no videoStorageUri) are unaffected.
  const isVideoLesson = Boolean(currentLesson?.videoStorageUri);
  // A video course = any lesson carries a video. Used to hide the article/slide
  // toggle ("View on Slides") which is meaningless for video content.
  const isVideoCourse = course.lessons.some((l) => Boolean(l.videoStorageUri));
  // For video lessons, the quiz stays locked until the watch-gate is met.
  // Admins bypass the gate; text lessons keep their existing (non-video) gating.
  const isVideoGateBlocked =
    isVideoLesson && !isAdminRole(userData?.role) && !isQuizUnlocked(watchedPct);

  const isQuizLocked = isQuizActive && quizStep === 'active' && !isAdminRole(userData?.role);

  const railUnlockedIndex =
    quizUnlocked || quizResults || isAdminRole(userData?.role)
      ? course?.lessons.length || 9999
      : highestUnlockedIndex;

  // Whether to show the shared rail + topbar (quiz views only)
  const showSharedLayout = isQuizIndex || (quizStep === 'review' && quizResults);

  // Attempt counters derive from the (unsorted) quizAttempts array: completed
  // attempts have timeTaken !== null; at most one in-progress draft has null.
  const completedAttemptCount =
    enrollment?.quizAttempts?.filter((a) => a.timeTaken !== null).length ?? 0;
  const activeDraftAttempt = enrollment?.quizAttempts?.find((a) => a.timeTaken === null);

  return (
    <div className="flex flex-row-reverse max-md:flex-col h-screen w-full overflow-hidden bg-background-secondary font-sans text-[#1a1a1a]">
      {showSharedLayout && (
        <CourseRail
          lessons={course.lessons}
          activeIndex={activeIndex}
          onSelect={handleRailSelect}
          unlockedIndex={railUnlockedIndex}
          quiz={course.quiz}
          onExitClick={() => {
            if (!isQuizLocked) {
              router.push(isAdminRole(userData?.role) ? '/dashboard/courses' : '/worker');
            }
          }}
          disableNav={isQuizLocked}
          isOpen={railOpen}
          onClose={() => setRailOpen(false)}
        />
      )}

      {/* Mobile Rail Toggle Button */}
      {showSharedLayout && (
        <button
          className="hidden max-md:flex fixed bottom-5 right-5 z-[70] h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#374151] shadow-[0_4px_12px_rgba(0,0,0,0.15)] transition-all hover:scale-105 hover:bg-[#f9fafb]"
          onClick={() => setRailOpen(true)}
          aria-label="Open module list"
        >
          <Menu width={20} height={20} strokeWidth={2} />
        </button>
      )}

      <div
        className="flex h-full flex-1 flex-col overflow-hidden"
        style={showSharedLayout ? {} : { width: '100%' }}
      >
        {showSharedLayout && (
          <header className="z-10 flex h-16 max-md:h-[52px] flex-shrink-0 items-center justify-between border-b border-[#e8e6e1] bg-[#fafaf8] px-8 max-md:gap-2 max-md:px-3">
            <div className="flex items-center gap-2.5 max-md:min-w-0 max-md:flex-1 max-md:overflow-hidden">
              <span className="text-[13px] font-medium text-[#9ca3af] max-md:hidden">Course</span>
              <span className="text-[13px] text-[#d1d5db] max-md:hidden">›</span>
              <span className="max-w-[400px] overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-[#374151] max-md:max-w-[200px] max-md:text-xs">
                {isQuizIndex ? course.quiz?.title || 'Quiz' : currentLesson?.title}
              </span>
              {!isQuizIndex && (
                <span className="ml-2 rounded-[20px] bg-[#f3f4f6] px-2.5 py-1 text-[11px] font-semibold text-text-muted max-md:hidden">
                  {course.duration || currentLesson?.duration || 5} min
                </span>
              )}
            </div>

            <div className="flex items-center gap-6 max-md:flex-shrink-0 max-md:gap-2">
              {!isQuizIndex && (
                <div className="flex gap-0.5 rounded-lg bg-[#efefed] p-[3px] max-md:p-0.5">
                  <Button
                    variant="ghost"
                    className={`h-auto cursor-pointer rounded-md border-none px-4 py-1.5 text-xs font-semibold tracking-[0.02em] transition-all max-md:px-2.5 max-md:py-[5px] max-md:text-[10px] ${viewMode === 'article' ? 'bg-white text-primary shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'bg-transparent text-text-muted'}`}
                    onClick={() => setViewMode('article')}
                  >
                    ARTICLE
                  </Button>
                  <Button
                    variant="ghost"
                    className={`h-auto cursor-pointer rounded-md border-none px-4 py-1.5 text-xs font-semibold tracking-[0.02em] transition-all max-md:px-2.5 max-md:py-[5px] max-md:text-[10px] ${viewMode === 'slides' ? 'bg-white text-primary shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'bg-transparent text-text-muted'}`}
                    onClick={() => setViewMode('slides')}
                  >
                    SLIDE
                  </Button>
                </div>
              )}
            </div>
          </header>
        )}

        <div className="relative h-full flex-1 overflow-hidden bg-[#f8f7f4]">
          {quizStep === 'review' && quizResults ? (
            <div style={{ overflow: 'auto', height: '100%', padding: 24 }}>
              <QuizResults
                courseId={courseId}
                enrollmentId={enrollment?.id || ''}
                data={{
                  courseName: course.title,
                  score: quizResults.score,
                  answered: quizResults.answered || quizResults.totalQuestions,
                  correct: quizResults.correct || quizResults.correctCount,
                  wrong: quizResults.wrong || quizResults.totalQuestions - quizResults.correctCount,
                  time: quizResults.time || 0,
                  questions: quizResults.questions || [],
                  attemptsUsed: quizResults.attemptsUsed,
                  allowedAttempts: quizResults.allowedAttempts,
                  passingScore: course.quiz?.passingScore,
                  userName: userData?.name,
                  userEmail: userData?.email,
                  jobTitle: userData?.jobTitle,
                }}
                hideActions={
                  enrollment?.status === 'completed' || enrollment?.status === 'attested'
                }
                showAttestation={isWorkerRole(userData?.role) && quizResults.passed}
                userRole={userData?.role}
                organizationName={userData?.organizationName}
                onAttestSuccess={() => {
                  setEnrollment((prev) => (prev ? { ...prev, status: 'attested' } : prev));
                }}
                onRetake={async () => {
                  if (enrollment?.id) {
                    try {
                      const { retakeQuiz } = await import('@/app/actions/course');
                      await retakeQuiz(enrollment.id);
                      window.location.reload();
                    } catch (err) {
                      logger.error({ msg: 'Failed to retake quiz:', err: err });
                      alert('Failed to start retake. Please try again.');
                    }
                  }
                }}
              />
            </div>
          ) : isQuizIndex ? (
            isAdminRole(userData?.role) ? (
              <div style={{ overflow: 'auto', height: '100%', padding: '24px 0' }}>
                <AdminQuizEditor
                  courseId={courseId}
                  initialQuestions={
                    course.quiz?.questions.map((q) => ({
                      ...q,
                      order: 0,
                    })) || []
                  }
                />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-start overflow-y-auto px-4 py-8 max-md:px-2 max-md:py-4 animate-in fade-in slide-in-from-bottom-3 duration-300">
                <div className="relative mx-auto flex w-full max-w-[800px] flex-col rounded-2xl border border-[#e8e6e1] bg-white shadow-[0_4px_12px_-2px_rgba(0,0,0,0.08),0_24px_48px_-12px_rgba(0,0,0,0.1)] max-md:rounded-xl">
                  <div className="hidden" />
                  <div className="flex flex-1 flex-col px-12 pt-10 pb-5 max-md:px-4 max-md:pt-5 max-md:pb-4">
                    {quizStep === 'intro' && (
                      <div className="mt-10 flex w-full flex-col items-center text-center">
                        <h1 className="mb-4 text-[32px] font-extrabold tracking-[-0.02em] text-[#111827] max-md:text-[22px] max-[480px]:text-[20px]">
                          {course.quiz?.title}
                        </h1>

                        {enrollment?.status === 'locked' ? (
                          <div
                            style={{
                              backgroundColor: '#FFF5F5',
                              borderRadius: '12px',
                              padding: '32px 24px',
                              border: '1px solid #FEB2B2',
                              marginTop: '24px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'center',
                                marginBottom: '16px',
                              }}
                            >
                              <div
                                style={{
                                  backgroundColor: '#FEE2E2',
                                  color: '#DC2626',
                                  width: '48px',
                                  height: '48px',
                                  borderRadius: '50%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <AlertCircle width={24} height={24} strokeWidth={2.5} />
                              </div>
                            </div>
                            <h2
                              style={{
                                color: '#9B2C2C',
                                fontSize: '20px',
                                fontWeight: 700,
                                margin: '0 0 12px 0',
                              }}
                            >
                              Maximum retries reached
                            </h2>
                            <p
                              style={{
                                color: '#C53030',
                                margin: 0,
                                fontSize: '15px',
                                lineHeight: 1.5,
                              }}
                            >
                              You have used all {course.quiz?.allowedAttempts} allowed attempts for
                              this quiz. An admin must assign a retake before you can continue.
                            </p>
                          </div>
                        ) : (
                          <>
                            <p className="mb-10 text-base leading-[1.6] text-[#6b7280] max-md:text-sm">
                              This quiz contains {course.quiz?.questions.length} questions.
                              <br />
                              Passing score: {course.quiz?.passingScore}%
                              {course.quiz?.allowedAttempts && (
                                <span
                                  style={{
                                    display: 'block',
                                    marginTop: 8,
                                    color: '#4A5568',
                                    fontWeight: 600,
                                  }}
                                >
                                  Attempt{' '}
                                  {Math.min(completedAttemptCount + 1, course.quiz.allowedAttempts)}{' '}
                                  of {course.quiz.allowedAttempts}
                                </span>
                              )}
                            </p>
                            <Button
                              variant="default"
                              style={{ fontSize: 16, padding: '12px 32px' }}
                              onClick={handleStartQuiz}
                            >
                              Start Quiz
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {quizStep === 'active' && course.quiz && (
                      <>
                        <div className="mb-8">
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              marginBottom: 16,
                            }}
                          >
                            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted">
                              Question {currentQuestionIndex + 1} of {course.quiz.questions.length}
                              {course.quiz.allowedAttempts &&
                                ` | Attempt ${activeDraftAttempt?.attemptCount ?? completedAttemptCount + 1} of ${course.quiz.allowedAttempts}`}
                            </span>
                            <span className="text-[11px] font-semibold text-text-muted">
                              {Math.floor(timeLeft / 60)}:
                              {(timeLeft % 60).toString().padStart(2, '0')}
                            </span>
                          </div>
                          <h2 className="text-2xl font-bold leading-[1.3] tracking-[-0.01em] text-foreground max-md:text-lg max-[480px]:text-base">
                            {course.quiz.questions[currentQuestionIndex].text}
                          </h2>
                        </div>
                        <div className="mb-8 grid grid-cols-1 gap-3">
                          {course.quiz.questions[currentQuestionIndex].options.map((opt, i) => {
                            const isSelected =
                              quizAnswers[course.quiz!.questions[currentQuestionIndex].id] === opt;
                            return (
                              <div
                                key={i}
                                data-quiz-option={i}
                                data-selected={isSelected}
                                className={`flex cursor-pointer items-center gap-4 rounded-xl border bg-white px-5 py-4 font-medium transition-all hover:-translate-y-px hover:border-primary hover:bg-background-secondary hover:shadow-[0_2px_4px_rgba(0,0,0,0.05)] max-md:gap-3 max-md:px-3.5 max-md:py-3 ${isSelected ? 'border-primary bg-background-secondary font-semibold text-primary shadow-[0_0_0_1px_var(--primary)]' : 'border-[#e5e7eb] text-[#374151]'}`}
                                onClick={() => handleOptionSelect(opt)}
                              >
                                <div
                                  className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-all ${isSelected ? 'bg-primary text-white' : 'bg-[#f3f4f6] text-[#6b7280]'}`}
                                >
                                  {String.fromCharCode(65 + i)}
                                </div>
                                <span>{opt}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-between border-t border-[#f3f4f6] pt-3 max-md:flex-wrap max-md:gap-2">
                          <Button
                            variant="outline"
                            onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
                            disabled={currentQuestionIndex === 0 || submitting}
                            style={
                              currentQuestionIndex === 0
                                ? { opacity: 0.5, cursor: 'not-allowed' }
                                : {}
                            }
                          >
                            Previous Question
                          </Button>
                          <Button
                            variant="default"
                            onClick={handleNextQuestion}
                            disabled={
                              !quizAnswers[course.quiz.questions[currentQuestionIndex].id] ||
                              submitting
                            }
                            style={
                              !quizAnswers[course.quiz.questions[currentQuestionIndex].id]
                                ? { opacity: 0.5, cursor: 'not-allowed' }
                                : {}
                            }
                          >
                            {currentQuestionIndex === course.quiz.questions.length - 1
                              ? submitting
                                ? 'Submitting...'
                                : 'Submit Quiz'
                              : 'Next Question'}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          ) : viewMode === 'slides' && isVideoLesson ? (
            <div className="flex h-full flex-col overflow-y-auto px-4 py-6 md:px-8 md:py-10">
              <div className="mx-auto w-full max-w-[860px]">
                <h2 className="mb-4 text-xl font-bold text-foreground md:text-2xl">
                  {currentLesson!.title}
                </h2>
                <VideoPlayer
                  lessonId={currentLesson!.id}
                  enrollmentId={enrollment!.id}
                  initialPositionSeconds={enrollment?.videoPositionSeconds ?? 0}
                  onWatchedPct={setWatchedPct}
                />
                {isVideoGateBlocked && (
                  <p className="mt-3 text-sm text-text-muted">Watch the video to unlock the quiz</p>
                )}
              </div>
            </div>
          ) : viewMode === 'slides' ? (
            <CourseSlide
              lesson={{
                title: currentLesson!.title,
                content: currentLesson!.slideContent || currentLesson!.content,
                moduleIndex: activeIndex,
                totalModules: course.lessons.length,
              }}
              onNext={handleNext}
              onPrev={handlePrev}
              isFirst={activeIndex === 0}
              isLast={activeIndex === course.lessons.length - 1 && !course.quiz}
              onToggleView={() => setViewMode('article')}
            />
          ) : (
            <CourseArticle
              title={course.title}
              lessons={course.lessons}
              activeIndex={activeIndex}
              onSelectModule={(index) => {
                if (index === course.lessons.length) {
                  handleRailSelect(index);
                } else if (index <= highestUnlockedIndex || isAdminRole(userData?.role)) {
                  setIsQuizActive(false);
                  setActiveIndex(index);
                  // Scroll to the module in article view
                  requestAnimationFrame(() => {
                    const el = document.getElementById(`module-${index}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  });
                }
              }}
              onToggleView={isVideoCourse ? undefined : () => setViewMode('slides')}
              onProceedToQuiz={() => {
                // Video watch-gate: block quiz entry until the gate is met.
                if (isVideoGateBlocked) return;
                const endIdx = course.lessons.length - 1;
                setHighestUnlockedIndex(endIdx);
                updateProgress(endIdx);
                setQuizUnlocked(true);
                setIsQuizActive(true);
                setQuizStep(quizResults ? 'review' : 'intro');
                setActiveIndex(course.lessons.length);
              }}
              proceedDisabled={isVideoGateBlocked}
              proceedHint="Watch the video to unlock the quiz"
              hasQuiz={!!course.quiz}
              onNext={handleNext}
              onPrev={handlePrev}
              isFirst={activeIndex === 0}
              isLast={activeIndex === course.lessons.length - 1 && !course.quiz}
            >
              {course.lessons.map((lesson, idx) => (
                <div
                  key={lesson.id}
                  id={`module-${idx}`}
                  style={{ marginBottom: idx < course.lessons.length - 1 ? '48px' : '0' }}
                >
                  {isAdminRole(userData?.role) ? (
                    <AdminLessonEditor
                      lesson={{
                        ...lesson,
                        moduleIndex: idx,
                        totalModules: course.lessons.length,
                      }}
                      onNext={handleNext}
                      onPrev={handlePrev}
                      isFirst={idx === 0}
                      isLast={idx === course.lessons.length - 1 && !course.quiz}
                    />
                  ) : (
                    <>
                      <h2
                        style={{
                          fontSize: '22px',
                          fontWeight: 700,
                          marginBottom: '8px',
                          color: '#4C6EF5',
                          letterSpacing: '0.5px',
                        }}
                      >
                        Module {idx + 1}
                      </h2>
                      <h3
                        style={{
                          fontSize: '20px',
                          fontWeight: 600,
                          marginBottom: '16px',
                          color: '#1A202C',
                        }}
                      >
                        {lesson.title}
                      </h3>
                      {lesson.videoStorageUri ? (
                        <>
                          <VideoPlayer
                            lessonId={lesson.id}
                            enrollmentId={enrollment!.id}
                            initialPositionSeconds={
                              idx === activeIndex ? (enrollment?.videoPositionSeconds ?? 0) : 0
                            }
                            onWatchedPct={idx === activeIndex ? setWatchedPct : undefined}
                          />
                          {idx === activeIndex && isVideoGateBlocked && (
                            <p className="mt-3 text-sm text-text-muted">
                              Watch the video to unlock the quiz
                            </p>
                          )}
                        </>
                      ) : (
                        <div
                          dangerouslySetInnerHTML={{
                            __html: sanitizeHtml(
                              (lesson.content || '')
                                .replace(/&nbsp;/g, ' ')
                                .replace(/<br\s*\/?>/gi, ' ')
                                .replace(/\s+/g, ' '),
                            ),
                          }}
                        />
                      )}
                      {idx < course.lessons.length - 1 && (
                        <hr
                          style={{
                            marginTop: '48px',
                            border: 'none',
                            borderTop: '2px solid #EDF2F7',
                          }}
                        />
                      )}
                    </>
                  )}
                </div>
              ))}
            </CourseArticle>
          )}
        </div>
      </div>

      {/* Modals */}
      {showQuizGateModal && !isAdminRole(userData?.role) && (
        <div
          className="fixed left-0 top-0 z-[100] flex h-full w-full items-center justify-center bg-black/50 backdrop-blur-[4px] animate-in fade-in duration-200"
          onClick={() => setShowQuizGateModal(false)}
        >
          <div
            className="flex w-full max-w-[480px] flex-col items-center rounded-2xl bg-white p-10 text-center shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)] animate-in zoom-in-95 duration-200 max-md:m-4 max-md:rounded-xl max-md:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#f3f4f6] text-5xl max-md:h-16 max-md:w-16 max-md:text-4xl">
              🎓
            </div>
            <h2 className="mb-3 text-2xl font-extrabold tracking-[-0.02em] text-foreground max-md:text-xl">
              Ready for the Quiz?
            </h2>
            <p className="mb-8 text-base leading-[1.5] text-text-muted max-md:text-sm">
              You&apos;ve completed all the course modules. Would you like to proceed to the quiz
              now?
            </p>
            <div className="flex w-full justify-center gap-3 max-md:flex-col">
              <Button variant="outline" onClick={() => setShowQuizGateModal(false)}>
                Review Modules
              </Button>
              <Button variant="default" onClick={handleConfirmQuiz}>
                Start Quiz
              </Button>
            </div>
          </div>
        </div>
      )}
      {showIncompleteModal && (
        <div
          className="fixed left-0 top-0 z-[100] flex h-full w-full items-center justify-center bg-black/50 backdrop-blur-[4px] animate-in fade-in duration-200"
          onClick={() => setShowIncompleteModal(false)}
        >
          <div
            className="flex w-full max-w-[480px] flex-col items-center rounded-2xl bg-white p-10 text-center shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)] animate-in zoom-in-95 duration-200 max-md:m-4 max-md:rounded-xl max-md:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#f3f4f6] text-5xl max-md:h-16 max-md:w-16 max-md:text-4xl">
              📚
            </div>
            <h2 className="mb-3 text-2xl font-extrabold tracking-[-0.02em] text-foreground max-md:text-xl">
              Complete All Modules First
            </h2>
            <p className="mb-8 text-base leading-[1.5] text-text-muted max-md:text-sm">
              You have <strong>{course.lessons.length - (highestUnlockedIndex + 1)}</strong>{' '}
              module(s) remaining. Please complete all modules in order.
            </p>
            <div className="flex w-full justify-center gap-3 max-md:flex-col">
              <Button variant="default" onClick={() => setShowIncompleteModal(false)}>
                Continue Learning
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
