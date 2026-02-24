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
    lessons: Lesson[];
    quiz?: Quiz;
}

interface EnrollmentData {
    id: string;
    progress: number;
    status: string;
    score?: number;
    quizAttempts?: any[];
}

interface UserData {
    name: string;
    role: string;
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
    const [viewMode, setViewMode] = useState<'slides' | 'article'>('slides');
    // activeIndex: 0..lessons.length-1 for modules, lessons.length for quiz
    const [activeIndex, setActiveIndex] = useState(0);

    // Linear progression
    const [highestUnlockedIndex, setHighestUnlockedIndex] = useState(0);

    // Quiz State
    const [isQuizActive, setIsQuizActive] = useState(false);
    const [quizStep, setQuizStep] = useState<'intro' | 'active' | 'results' | 'review'>('intro');
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
    const [timeLeft, setTimeLeft] = useState(0);
    const [quizResults, setQuizResults] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);

    // Modal State
    const [showQuizGateModal, setShowQuizGateModal] = useState(false);
    const [showIncompleteModal, setShowIncompleteModal] = useState(false);

    // Quiz unlocked flag
    const [quizUnlocked, setQuizUnlocked] = useState(false);

    // Track if user just finished quiz in this session
    const [justFinished, setJustFinished] = useState(false);

    // Initial Fetch
    useEffect(() => {
        const fetchCourseData = async () => {
            try {
                const res = await fetch(`/api/courses/${params.id}/learn`);
                if (!res.ok) throw new Error('Failed to load course');
                const data = await res.json();

                // Map lesson data to include moduleIndex
                if (data.course.lessons) {
                    data.course.lessons = data.course.lessons.map((l: any, i: number) => ({ ...l, moduleIndex: i }));
                }

                setCourse(data.course);
                setEnrollment(data.enrollment);
                setUserData(data.user);

                const lessonCount = data.course.lessons?.length || 1;

                // Restore state from backend progress
                // Check if there is an ACTIVE attempt (timeTaken is null)
                // Note: route.ts now returns answers inside quizAttempts
                const activeAttempt = data.enrollment?.quizAttempts?.find((a: any) => a.timeTaken === null);

                const hasQuizAttempt = data.enrollment?.quizAttempts?.length > 0;
                const isCompleted = data.enrollment?.status === 'completed' || data.enrollment?.status === 'attested';

                if (activeAttempt) {
                    // RESTORE ACTIVE SESSION
                    setQuizUnlocked(true);
                    setHighestUnlockedIndex(lessonCount - 1); // Ensure they can see the quiz
                    setActiveIndex(lessonCount); // Go to quiz tab
                    setIsQuizActive(true);
                    setQuizStep('active');

                    // Restore answers
                    const savedAnswers: Record<string, string> = {};
                    if (Array.isArray(activeAttempt.answers)) {
                        activeAttempt.answers.forEach((ans: any) => {
                            savedAnswers[ans.questionId] = ans.selectedAnswer;
                        });
                    }
                    setQuizAnswers(savedAnswers);

                    // Restore Timer
                    // completedAt in active attempt holds the START time (based on our logic in start/route.ts)
                    const startedAt = new Date(activeAttempt.completedAt).getTime();
                    const now = new Date().getTime();
                    const elapsedSeconds = Math.floor((now - startedAt) / 1000);

                    const limit = data.course.quiz?.timeLimit
                        ? data.course.quiz.timeLimit * 60
                        : (data.course.quiz?.questions.length || 5) * 60;

                    const remaining = Math.max(0, limit - elapsedSeconds);
                    setTimeLeft(remaining);


                    setTimeLeft(remaining);

                } else if ((isCompleted || (hasQuizAttempt && !activeAttempt)) && data.enrollment?.status !== 'in_progress') {
                    // Course completed or quiz taken (and finished) — lock to results view only
                    // But if status is 'in_progress' (e.g. retake), allow them to proceed to Intro/Active.
                    const resultsData = data.quizResultsData || {
                        passed: (data.enrollment.score || 0) >= (data.course.quiz?.passingScore || 70),
                        score: data.enrollment.score || 0,
                        totalQuestions: 0,
                        correctCount: 0,
                        answered: 0,
                        correct: 0,
                        wrong: 0,
                        time: 0,
                        questions: []
                    };
                    setQuizResults(resultsData);
                    if (data.course.lessons) setActiveIndex(data.course.lessons.length);
                    setIsQuizActive(true);
                    setQuizStep('review');
                    setQuizUnlocked(true);
                    setHighestUnlockedIndex(lessonCount - 1); // Allow nav through all lessons
                } else if (data.enrollment?.progress > 0) {
                    // Restore to correct lesson from saved progress
                    const savedProgress = data.enrollment.progress;
                    const restoredIndex = Math.min(
                        Math.round((savedProgress / 100) * lessonCount) - 1,
                        lessonCount - 1
                    );
                    const startIndex = Math.max(0, restoredIndex);
                    setActiveIndex(startIndex);
                    setHighestUnlockedIndex(startIndex);

                    // If 100%, all lessons done — unlock quiz
                    if (savedProgress >= 100) {
                        setQuizUnlocked(true);
                        setHighestUnlockedIndex(lessonCount - 1);
                    }
                } else {
                    setHighestUnlockedIndex(0);
                }
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchCourseData();
    }, [params.id]);

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
    }, [isQuizActive, quizStep, timeLeft]);

    const allLessonsComplete = course
        ? highestUnlockedIndex >= course.lessons.length - 1
        : false;

    // Determine what to pass to Rail as unlockedIndex
    // If quiz is unlocked for attempts, we pass lessons.length (so quiz index is <= unlocked)
    // Otherwise we pass highestUnlockedIndex which caps at lessons.length-1
    const railUnlockedIndex = (quizUnlocked || quizResults || userData?.role === 'admin')
        ? (course?.lessons.length || 9999)
        : highestUnlockedIndex;

    const handleRailSelect = (index: number) => {
        if (!course) return;

        // Quiz Index Selection
        if (index === course.lessons.length) {
            if (quizUnlocked || quizResults || userData?.role === 'admin') {
                setIsQuizActive(true);
                setQuizStep(quizResults ? 'review' : 'intro');
                setActiveIndex(index);
            } else if (allLessonsComplete) {
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
                    body: JSON.stringify({ progress })
                });
                setEnrollment(prev => prev ? { ...prev, progress } : prev);
            } catch (err) {
                console.error('Failed to update progress', err);
            }
        }
    };

    // Quiz Handlers
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
                body: JSON.stringify({ enrollmentId: enrollment.id })
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

        // Debounce or just fire-and-forget save to backend
        // For simplicity in this iteration, we fire-and-forget (optimistic UI)
        try {
            // Convert to array format for backend
            const answersArray = Object.entries(newAnswers).map(([qId, val]) => ({
                questionId: qId,
                selectedAnswer: val
            }));

            await fetch(`/api/quiz/${course.quiz.id}/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enrollmentId: enrollment.id,
                    answers: answersArray
                })
            });
        } catch (err) {
            console.error('Failed to save progress', err);
        }
    };

    const handleNextQuestion = () => {
        if (!course?.quiz) return;
        if (currentQuestionIndex < course.quiz.questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
        } else {
            handleSubmitQuiz();
        }
    };

    const handleSubmitQuiz = async () => {
        if (!course?.quiz || !enrollment) return;
        setSubmitting(true);
        const answers = Object.entries(quizAnswers).map(([qId, val]) => ({
            questionId: qId,
            selectedAnswer: val
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
                    timeTaken: timeTaken
                })
            });
            if (!res.ok) throw new Error('Failed to submit');
            const result = await res.json();
            setQuizResults(result);
            setQuizStep('review');
            if (result.passed) {
                setJustFinished(true);
            }
        } catch (err) {
            console.error(err);
            alert('Failed to submit quiz');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className={styles.playerContainer} style={{ justifyContent: 'center', alignItems: 'center' }}>Loading...</div>;
    if (error) return <div className={styles.playerContainer} style={{ justifyContent: 'center', alignItems: 'center' }}>Error: {error}</div>;
    if (!course) return null;

    const isQuizIndex = activeIndex >= course.lessons.length;
    const currentLesson = !isQuizIndex ? course.lessons[activeIndex] : null;

    // Lock navigation if worker is taking quiz
    const isQuizLocked = isQuizActive && quizStep === 'active' && userData?.role !== 'admin';

    return (
        <div className={styles.playerContainer}>
            <CourseRail
                lessons={course.lessons}
                activeIndex={activeIndex}
                onSelect={handleRailSelect}
                unlockedIndex={railUnlockedIndex}
                quiz={course.quiz}
                onLogoClick={() => !isQuizLocked && router.push('/dashboard/worker')}
                disableNav={isQuizLocked}
            />

            <div className={styles.main}>
                {/* Topbar */}
                <header className={styles.topbar}>
                    <div className={styles.topbarLeft}>
                        <span className={styles.breadcrumb}>Course</span>
                        <span className={styles.breadcrumbSep}>›</span>
                        <span className={styles.breadcrumbActive}>
                            {isQuizIndex ? (course.quiz?.title || 'Quiz') : currentLesson?.title}
                        </span>
                        {!isQuizIndex && <span className={styles.durationPill}>{currentLesson?.duration || 5} min</span>}
                    </div>

                    <div className={styles.topbarRight}>
                        {enrollment && enrollment.id !== 'preview-mode' && (
                            <div className={styles.progressIndicator}>
                                <span className={styles.progressText}>{Math.min(enrollment.progress || 0, 100)}%</span>
                                <div className={styles.progressBar}>
                                    <div className={styles.progressFill} style={{ width: `${Math.min(enrollment.progress || 0, 100)}%` }} />
                                </div>
                            </div>
                        )}

                        {!isQuizIndex && (
                            <div className={styles.toggle}>
                                <button
                                    className={`${styles.toggleBtn} ${viewMode === 'article' ? styles.toggleBtnActive : ''}`}
                                    onClick={() => setViewMode('article')}
                                >
                                    ARTICLE
                                </button>
                                <button
                                    className={`${styles.toggleBtn} ${viewMode === 'slides' ? styles.toggleBtnActive : ''}`}
                                    onClick={() => setViewMode('slides')}
                                >
                                    SLIDE
                                </button>
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
                                    wrong: quizResults.wrong || (quizResults.totalQuestions - quizResults.correctCount),
                                    time: quizResults.time || 0,
                                    questions: quizResults.questions || [],
                                    attemptsUsed: quizResults.attemptsUsed,
                                    allowedAttempts: quizResults.allowedAttempts,
                                    passingScore: course.quiz?.passingScore
                                } as any}
                                hideActions={enrollment?.status === 'completed' || enrollment?.status === 'attested'}
                                showAttestation={justFinished && userData?.role === 'worker' && quizResults.passed}
                                userRole={userData?.role}
                                onAttestSuccess={() => {
                                    setJustFinished(false);
                                    setEnrollment(prev => prev ? { ...prev, status: 'attested' } : prev);
                                }}
                                onRetake={async () => {
                                    if (enrollment?.id) {
                                        // Call server action to reset status
                                        try {
                                            const { retakeQuiz } = await import('@/app/actions/course');
                                            await retakeQuiz(enrollment.id);
                                            // Reload page to sync state completely
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
                        // QUIZ VIEW
                        userData?.role === 'admin' ? (
                            <div style={{ overflow: 'auto', height: '100%', padding: '24px 0' }}>
                                <AdminQuizEditor
                                    courseId={courseId}
                                    initialQuestions={course.quiz?.questions.map(q => ({
                                        ...q,
                                        order: 0 // Order handled by index in editor
                                    })) || []}
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
                                                <p className={styles.quizIntroText}>
                                                    This quiz contains {course.quiz?.questions.length} questions.<br />
                                                    Passing score: {course.quiz?.passingScore}%
                                                    {course.quiz?.allowedAttempts && (
                                                        <span style={{ display: 'block', marginTop: 8, color: '#E53E3E', fontWeight: 600 }}>
                                                            {((enrollment?.quizAttempts?.[0]?.attemptCount || 0) >= course.quiz.allowedAttempts)
                                                                ? `All ${course.quiz.allowedAttempts} attempts used`
                                                                : `Attempt ${(enrollment?.quizAttempts?.[0]?.attemptCount || 0) + 1} of ${course.quiz.allowedAttempts}`}
                                                        </span>
                                                    )}
                                                </p>
                                                <button className={styles.btnPrimary} style={{ fontSize: 16, padding: '12px 32px' }} onClick={handleStartQuiz}>
                                                    Start Quiz
                                                </button>
                                            </div>
                                        )}

                                        {quizStep === 'active' && course.quiz && (
                                            <>
                                                <div className={styles.quizHeader}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                                                        <span className={styles.slideModuleLabel}>
                                                            Question {currentQuestionIndex + 1} of {course.quiz.questions.length}
                                                            {course.quiz.allowedAttempts && ` | Attempt ${enrollment?.quizAttempts?.[0]?.attemptCount || 1} of ${course.quiz.allowedAttempts}`}
                                                        </span>
                                                        <span className={styles.slideCounter}>{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</span>
                                                    </div>
                                                    <h2 className={styles.quizQuestion}>{course.quiz.questions[currentQuestionIndex].text}</h2>
                                                </div>
                                                <div className={styles.optionsGrid}>
                                                    {course.quiz.questions[currentQuestionIndex].options.map((opt, i) => (
                                                        <div
                                                            key={i}
                                                            className={`${styles.optionBox} ${quizAnswers[course.quiz!.questions[currentQuestionIndex].id] === opt ? styles.selected : ''}`}
                                                            onClick={() => handleOptionSelect(opt)}
                                                        >
                                                            <div className={styles.optionLetter}>{String.fromCharCode(65 + i)}</div>
                                                            <span>{opt}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className={styles.quizFooter}>
                                                    <button
                                                        className={styles.modalBtnSecondary}
                                                        onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
                                                        disabled={currentQuestionIndex === 0 || submitting}
                                                        style={currentQuestionIndex === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                                                    >
                                                        Previous Question
                                                    </button>
                                                    <button
                                                        className={styles.btnPrimary}
                                                        onClick={handleNextQuestion}
                                                        disabled={!quizAnswers[course.quiz.questions[currentQuestionIndex].id] || submitting}
                                                        style={!quizAnswers[course.quiz.questions[currentQuestionIndex].id] ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                                                    >
                                                        {currentQuestionIndex === course.quiz.questions.length - 1 ? (submitting ? 'Submitting...' : 'Submit Quiz') : 'Next Question'}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )) : (
                        // LESSON VIEW
                        viewMode === 'slides' ? (
                            <CourseSlide
                                lesson={{
                                    title: currentLesson!.title,
                                    content: currentLesson!.content,
                                    moduleIndex: activeIndex,
                                    totalModules: course.lessons.length
                                }}
                                onNext={handleNext}
                                onPrev={handlePrev}
                                isFirst={activeIndex === 0}
                                isLast={activeIndex === course.lessons.length - 1 && !course.quiz}
                            />
                        ) : (
                            userData?.role === 'admin' ? (
                                <AdminLessonEditor
                                    lesson={{
                                        id: currentLesson!.id,
                                        title: currentLesson!.title || '',
                                        content: currentLesson!.content || '',
                                        moduleIndex: activeIndex,
                                        totalModules: course.lessons.length
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
                                        <div key={lesson.id} id={`module-${idx}`} style={{ marginBottom: idx < course.lessons.length - 1 ? '48px' : '0' }}>
                                            <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: '#1A202C' }}>
                                                {idx + 1}. {lesson.title}
                                            </h2>
                                            <div dangerouslySetInnerHTML={{
                                                __html: (lesson.content || '')
                                                    .replace(/&nbsp;/g, ' ')
                                                    .replace(/<br\s*\/?>/gi, ' ')
                                                    .replace(/\s+/g, ' ')
                                            }} />
                                            {idx < course.lessons.length - 1 && <hr style={{ marginTop: '48px', border: 'none', borderTop: '1px solid #EDF2F7' }} />}
                                        </div>
                                    ))}
                                </CourseArticle>
                            )
                        ))}

                </div>
            </div>

            {/* Modals */}
            {showQuizGateModal && userData?.role !== 'admin' && (
                <div className={styles.modalOverlay} onClick={() => setShowQuizGateModal(false)}>
                    <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalIcon}>🎓</div>
                        <h2 className={styles.modalTitle}>Ready for the Quiz?</h2>
                        <p className={styles.modalText}>You've completed all the course modules. Would you like to proceed to the quiz now?</p>
                        <div className={styles.modalActions}>
                            <button className={styles.modalBtnSecondary} onClick={() => setShowQuizGateModal(false)}>Review Modules</button>
                            <button className={styles.modalBtnPrimary} onClick={handleConfirmQuiz}>Start Quiz</button>
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
                            You have <strong>{course.lessons.length - (highestUnlockedIndex + 1)}</strong> module(s) remaining.
                            Please complete all modules in order.
                        </p>
                        <div className={styles.modalActions}>
                            <button className={styles.modalBtnPrimary} onClick={() => setShowIncompleteModal(false)}>Continue Learning</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
