'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import styles from '../../../components/courses/CoursePlayer.module.css';
import QuizResults from '@/components/dashboard/training/QuizResults';

// Reusable Components
import CourseRail from '@/components/courses/CourseRail';
import CourseSlide from '@/components/courses/CourseSlide';
import CourseArticle from '@/components/courses/CourseArticle';
import AdminQuizEditor from '@/components/courses/AdminQuizEditor';
import AdminLessonEditor from '@/components/courses/AdminLessonEditor';
import { Button } from '@/components/ui';
import { sanitizeHtml } from '@/lib/sanitize';

interface Lesson {
  id: string;
  title: string;
  content: string;
  duration: number | null;
  order: number;
  moduleIndex: number;
}

interface Question {
  id: string;
  text: string;
  type: string;
  options: string[];
  correctAnswer: string;
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
        console.error('Failed to update progress', err);
      }
    }
  };

  const handleSubmitQuiz = async () => {
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
      console.error(err);
      alert('Failed to submit quiz');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNextQuestion = () => {
    if (!course?.quiz) return;
    if (currentQuestionIndex < course.quiz.questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    } else {
      handleSubmitQuiz();
    }
  };

  const handleRailSelect = (index: number) => {
    if (!course) return;

    // Quiz Index Selection
    if (index === course.lessons.length) {
      if (quizUnlocked || quizResults || userData?.role === 'admin') {
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
    if (index <= highestUnlockedIndex || userData?.role === 'admin') {
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
      // Reached end of lessons, check quiz
      if (course.lessons.length - 1 > highestUnlockedIndex) {
        setHighestUnlockedIndex(course.lessons.length - 1);
      }
      updateProgress(course.lessons.length - 1);

      if (quizUnlocked || userData?.role === 'admin') {
        setIsQuizActive(true);
        setQuizStep('intro');
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
      // Start attempt on backend
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
      console.error('Failed to start quiz', err);
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
      console.error('Failed to save progress', err);
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

        // Map lesson data to include moduleIndex
        if (data.course.lessons) {
          data.course.lessons = data.course.lessons.map((l: Lesson, i: number) => ({
            ...l,
            moduleIndex: i,
          }));
        }

        setCourse(data.course);
        setEnrollment(data.enrollment);
        setUserData(data.user);

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
        } else if (
          (isCompleted ||
            data.enrollment?.status === 'locked' ||
            (hasQuizAttempt && !activeAttempt)) &&
          data.enrollment?.status !== 'in_progress'
        ) {
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
      <div
        className={styles.playerContainer}
        style={{ justifyContent: 'center', alignItems: 'center' }}
      >
        Loading...
      </div>
    );
  if (error)
    return (
      <div
        className={styles.playerContainer}
        style={{ justifyContent: 'center', alignItems: 'center' }}
      >
        Error: {error}
      </div>
    );
  if (!course) return null;

  const isQuizIndex = activeIndex >= course.lessons.length;
  const currentLesson = !isQuizIndex ? course.lessons[activeIndex] : null;

  const isQuizLocked = isQuizActive && quizStep === 'active' && userData?.role !== 'admin';

  const railUnlockedIndex =
    quizUnlocked || quizResults || userData?.role === 'admin'
      ? course?.lessons.length || 9999
      : highestUnlockedIndex;

  return (
    <div className={styles.playerContainer}>
      <CourseRail
        lessons={course.lessons}
        activeIndex={activeIndex}
        onSelect={handleRailSelect}
        unlockedIndex={railUnlockedIndex}
        quiz={course.quiz}
        onExitClick={() => {
          if (!isQuizLocked) {
            router.push(userData?.role === 'admin' ? '/dashboard/courses' : '/dashboard/worker');
          }
        }}
        disableNav={isQuizLocked}
        isOpen={railOpen}
        onClose={() => setRailOpen(false)}
      />

      {/* Mobile Rail Toggle Button */}
      <button
        className={styles.railToggle}
        onClick={() => setRailOpen(true)}
        aria-label="Open module list"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <span className={styles.breadcrumb}>Course</span>
            <span className={styles.breadcrumbSep}>›</span>
            <span className={styles.breadcrumbActive}>
              {isQuizIndex ? course.quiz?.title || 'Quiz' : currentLesson?.title}
            </span>
            {!isQuizIndex && (
              <span className={styles.durationPill}>
                {course.duration || currentLesson?.duration || 5} min
              </span>
            )}
          </div>

          <div className={styles.topbarRight}>
            {!isQuizIndex && (
              <div className={styles.toggle}>
                <Button
                  variant="ghost"
                  className={`${styles.toggleBtn} ${viewMode === 'article' ? styles.toggleBtnActive : ''}`}
                  onClick={() => setViewMode('article')}
                >
                  ARTICLE
                </Button>
                <Button
                  variant="ghost"
                  className={`${styles.toggleBtn} ${viewMode === 'slides' ? styles.toggleBtnActive : ''}`}
                  onClick={() => setViewMode('slides')}
                >
                  SLIDE
                </Button>
              </div>
            )}
          </div>
        </header>

        <div className={styles.contentArea}>
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
                showAttestation={userData?.role === 'worker' && quizResults.passed}
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
                      console.error('Failed to retake quiz:', err);
                      alert('Failed to start retake. Please try again.');
                    }
                  }
                }}
              />
            </div>
          ) : isQuizIndex ? (
            userData?.role === 'admin' ? (
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
              <div className={`${styles.slideStage} ${styles.fadeEnter}`}>
                <div className={styles.quizCard}>
                  <div className={styles.slideAccent} />
                  <div className={styles.quizInner}>
                    {quizStep === 'intro' && (
                      <div className={styles.quizIntro}>
                        <h1 className={styles.quizIntroTitle}>{course.quiz?.title}</h1>

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
                                <svg
                                  width="24"
                                  height="24"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <circle cx="12" cy="12" r="10"></circle>
                                  <line x1="12" y1="8" x2="12" y2="12"></line>
                                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                </svg>
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
                            <p className={styles.quizIntroText}>
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
                                  Attempt {(enrollment?.quizAttempts?.[0]?.attemptCount || 0) + 1}{' '}
                                  of {course.quiz.allowedAttempts}
                                </span>
                              )}
                            </p>
                            <Button
                              variant="primary"
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
                        <div className={styles.quizHeader}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              marginBottom: 16,
                            }}
                          >
                            <span className={styles.slideModuleLabel}>
                              Question {currentQuestionIndex + 1} of {course.quiz.questions.length}
                              {course.quiz.allowedAttempts &&
                                ` | Attempt ${enrollment?.quizAttempts?.[0]?.attemptCount || 1} of ${course.quiz.allowedAttempts}`}
                            </span>
                            <span className={styles.slideCounter}>
                              {Math.floor(timeLeft / 60)}:
                              {(timeLeft % 60).toString().padStart(2, '0')}
                            </span>
                          </div>
                          <h2 className={styles.quizQuestion}>
                            {course.quiz.questions[currentQuestionIndex].text}
                          </h2>
                        </div>
                        <div className={styles.optionsGrid}>
                          {course.quiz.questions[currentQuestionIndex].options.map((opt, i) => (
                            <div
                              key={i}
                              className={`${styles.optionBox} ${quizAnswers[course.quiz!.questions[currentQuestionIndex].id] === opt ? styles.selected : ''}`}
                              onClick={() => handleOptionSelect(opt)}
                            >
                              <div className={styles.optionLetter}>
                                {String.fromCharCode(65 + i)}
                              </div>
                              <span>{opt}</span>
                            </div>
                          ))}
                        </div>
                        <div className={styles.quizFooter}>
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
                            variant="primary"
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
          ) : viewMode === 'slides' ? (
            <CourseSlide
              lesson={{
                title: currentLesson!.title,
                content: currentLesson!.content,
                moduleIndex: activeIndex,
                totalModules: course.lessons.length,
              }}
              onNext={handleNext}
              onPrev={handlePrev}
              isFirst={activeIndex === 0}
              isLast={activeIndex === course.lessons.length - 1 && !course.quiz}
            />
          ) : (
            <CourseArticle
              title={course.title}
              onProceedToQuiz={() => {
                const endIdx = course.lessons.length - 1;
                setHighestUnlockedIndex(endIdx);
                updateProgress(endIdx);
                setQuizUnlocked(true);
                setIsQuizActive(true);
                setQuizStep('intro');
                setActiveIndex(course.lessons.length);
              }}
              hasQuiz={!!course.quiz}
            >
              {course.lessons.map((lesson, idx) => (
                <div
                  key={lesson.id}
                  id={`module-${idx}`}
                  style={{ marginBottom: idx < course.lessons.length - 1 ? '48px' : '0' }}
                >
                  {userData?.role === 'admin' ? (
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
      {showQuizGateModal && userData?.role !== 'admin' && (
        <div className={styles.modalOverlay} onClick={() => setShowQuizGateModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalIcon}>🎓</div>
            <h2 className={styles.modalTitle}>Ready for the Quiz?</h2>
            <p className={styles.modalText}>
              You&apos;ve completed all the course modules. Would you like to proceed to the quiz
              now?
            </p>
            <div className={styles.modalActions}>
              <Button variant="outline" onClick={() => setShowQuizGateModal(false)}>
                Review Modules
              </Button>
              <Button variant="primary" onClick={handleConfirmQuiz}>
                Start Quiz
              </Button>
            </div>
          </div>
        </div>
      )}
      {showIncompleteModal && (
        <div className={styles.modalOverlay} onClick={() => setShowIncompleteModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalIcon}>📚</div>
            <h2 className={styles.modalTitle}>Complete All Modules First</h2>
            <p className={styles.modalText}>
              You have <strong>{course.lessons.length - (highestUnlockedIndex + 1)}</strong>{' '}
              module(s) remaining. Please complete all modules in order.
            </p>
            <div className={styles.modalActions}>
              <Button variant="primary" onClick={() => setShowIncompleteModal(false)}>
                Continue Learning
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
