'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import styles from './LearnerRedesign.module.css';
import SlideContentFitter from '@/components/ui/SlideContentFitter';
import QuizResults from '@/components/dashboard/training/QuizResults';

interface Lesson {
    id: string;
    title: string;
    content: string;
    duration: number | null;
    order: number;
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
    const [activeIndex, setActiveIndex] = useState(0);

    // Linear progression: the highest module index the user has unlocked
    // They can navigate back to 0..highestUnlockedIndex, but never skip ahead
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

    // Initial Fetch
    useEffect(() => {
        const fetchCourseData = async () => {
            try {
                const res = await fetch(`/api/courses/${params.id}/learn`);
                if (!res.ok) throw new Error('Failed to load course');
                const data = await res.json();
                setCourse(data.course);
                setEnrollment(data.enrollment);
                setUserData(data.user);

                const lessonCount = data.course.lessons?.length || 1;

                // Restore state from backend progress
                const hasQuizAttempt = data.enrollment?.quizAttempts?.length > 0;
                const isCompleted = data.enrollment?.status === 'completed' || data.enrollment?.status === 'attested';

                if (isCompleted || hasQuizAttempt) {
                    // Course completed or quiz taken — lock to results view only
                    const resultsData = data.quizResultsData || {
                        passed: (data.enrollment.score || 0) >= 70,
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
                    setHighestUnlockedIndex(lessonCount - 1);
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
                    // Fresh start — only module 0 unlocked
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

    // Check if all lessons are unlocked (reached the last one)
    const allLessonsComplete = course
        ? highestUnlockedIndex >= course.lessons.length - 1
        : false;

    // Navigation: sidebar click — only allowed for unlocked modules
    const handleNavClick = (index: number) => {
        if (!course) return;

        // Clicking the quiz dot
        if (index === course.lessons.length) {
            if (quizUnlocked || quizResults) {
                setIsQuizActive(true);
                if (quizResults) setQuizStep('review');
                else setQuizStep('intro');
                setActiveIndex(index);
            } else if (allLessonsComplete) {
                setShowQuizGateModal(true);
            } else {
                setShowIncompleteModal(true);
            }
            return;
        }

        // Block if trying to go to a module that isn't unlocked yet
        if (index > highestUnlockedIndex) {
            return; // Simply ignore — the dot is visually locked
        }

        // Navigate to an already-unlocked lesson
        setIsQuizActive(false);
        setActiveIndex(index);
    };

    // Next: the ONLY way to advance and unlock new modules
    const handleNext = () => {
        if (!course) return;

        if (activeIndex < course.lessons.length - 1) {
            // Advance to next lesson
            const nextIndex = activeIndex + 1;

            // Unlock if this is a new high
            if (nextIndex > highestUnlockedIndex) {
                setHighestUnlockedIndex(nextIndex);
            }

            setIsQuizActive(false);
            setActiveIndex(nextIndex);
            updateProgress(nextIndex);

        } else if (activeIndex === course.lessons.length - 1 && course.quiz) {
            // On the last lesson — try to go to quiz
            // Make sure we've recorded reaching the last lesson
            if (course.lessons.length - 1 > highestUnlockedIndex) {
                setHighestUnlockedIndex(course.lessons.length - 1);
            }
            updateProgress(course.lessons.length - 1);

            if (quizUnlocked) {
                setIsQuizActive(true);
                setQuizStep('intro');
                setActiveIndex(course.lessons.length);
            } else {
                // Show the "Ready for quiz?" modal
                setShowQuizGateModal(true);
            }
        }
    };

    // Previous: can only go back within unlocked range
    const handlePrev = () => {
        if (activeIndex > 0) {
            const prevIndex = activeIndex - 1;
            setIsQuizActive(false);
            setActiveIndex(prevIndex);
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

    // Quiz Gate Modal — user confirms proceeding to quiz
    const handleConfirmQuiz = () => {
        setShowQuizGateModal(false);
        setQuizUnlocked(true);
        setIsQuizActive(true);
        setQuizStep('intro');
        setActiveIndex(course!.lessons.length);
    };

    // Quiz Actions
    const handleStartQuiz = () => {
        setQuizStep('active');
        setCurrentQuestionIndex(0);
        setQuizAnswers({});
        const limit = course?.quiz?.timeLimit
            ? course.quiz.timeLimit * 60
            : (course?.quiz?.questions.length || 5) * 60;
        setTimeLeft(limit);
    };

    const handleOptionSelect = (option: string) => {
        if (!course?.quiz) return;
        const questionId = course.quiz.questions[currentQuestionIndex].id;
        setQuizAnswers(prev => ({ ...prev, [questionId]: option }));
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

        try {
            const res = await fetch(`/api/quiz/${course.quiz.id}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enrollmentId: enrollment.id,
                    answers,
                    timeTaken: 0
                })
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

    const handleRetake = () => {
        setQuizResults(null);
        setQuizStep('intro');
    };

    if (loading) return <div className={styles.app} style={{ justifyContent: 'center', alignItems: 'center' }}>Loading...</div>;
    if (error) return <div className={styles.app} style={{ justifyContent: 'center', alignItems: 'center' }}>Error: {error}</div>;
    if (!course) return null;

    const isQuizIndex = activeIndex >= course.lessons.length;
    const currentLesson = !isQuizIndex ? course.lessons[activeIndex] : null;

    // Render the sidebar with locked/unlocked module dots
    const renderSidebar = () => (
        <nav className={styles.rail}>
            <div className={styles.railLogo} onClick={() => router.push('/dashboard/worker')}>
                <svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
            </div>
            {course.lessons.map((l, i) => {
                const isActive = i === activeIndex && !isQuizIndex;
                const isUnlocked = i <= highestUnlockedIndex;
                const isDone = isUnlocked && i < activeIndex;
                const isLocked = !isUnlocked;
                // Lock all lesson dots when quiz is in progress or results are showing
                const courseLocked = (quizStep === 'active' && isQuizActive) || quizStep === 'review';

                return (
                    <button
                        key={l.id}
                        className={`${styles.modDot} ${isActive ? styles.modDotActive : isDone ? styles.modDotDone : (isLocked || courseLocked) ? styles.modDotLocked : ''}`}
                        onClick={() => handleNavClick(i)}
                        title={courseLocked ? 'Quiz completed' : isLocked ? `Module ${i + 1} — Locked` : l.title}
                        disabled={isLocked || courseLocked}
                    >
                        {(isLocked && !courseLocked) ? '🔒' : i + 1}
                    </button>
                );
            })}
            {course.quiz && (
                <button
                    className={`${styles.modDot} ${styles.modDotQuiz} ${isQuizIndex ? styles.modDotQuizActive : ''} ${!quizUnlocked && !quizResults ? styles.modDotLocked : ''}`}
                    onClick={() => handleNavClick(course.lessons.length)}
                    title={quizUnlocked || quizResults ? 'Quiz' : 'Complete all modules to unlock'}
                >
                    {quizUnlocked || quizResults ? 'Q' : '🔒'}
                </button>
            )}
        </nav>
    );

    const renderTopbar = () => (
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
                {/* Progress indicator */}
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
    );

    // Quiz Gate Confirmation Modal
    const renderQuizGateModal = () => (
        <div className={styles.modalOverlay} onClick={() => setShowQuizGateModal(false)}>
            <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalIcon}>🎓</div>
                <h2 className={styles.modalTitle}>Ready for the Quiz?</h2>
                <p className={styles.modalText}>
                    You've completed all the course modules. Would you like to proceed to the quiz now?
                </p>
                <div className={styles.modalActions}>
                    <button className={styles.modalBtnSecondary} onClick={() => setShowQuizGateModal(false)}>
                        Review Modules
                    </button>
                    <button className={styles.modalBtnPrimary} onClick={handleConfirmQuiz}>
                        Start Quiz
                    </button>
                </div>
            </div>
        </div>
    );

    // Incomplete Lessons Modal
    const renderIncompleteModal = () => {
        const remaining = course.lessons.length - (highestUnlockedIndex + 1);
        return (
            <div className={styles.modalOverlay} onClick={() => setShowIncompleteModal(false)}>
                <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.modalIcon}>📚</div>
                    <h2 className={styles.modalTitle}>Complete All Modules First</h2>
                    <p className={styles.modalText}>
                        You have <strong>{remaining}</strong> module{remaining !== 1 ? 's' : ''} remaining.
                        Please complete all modules in order before proceeding to the quiz.
                    </p>
                    <div className={styles.modalActions}>
                        <button className={styles.modalBtnPrimary} onClick={() => setShowIncompleteModal(false)}>
                            Continue Learning
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className={styles.app}>
            {renderSidebar()}

            <div className={styles.main}>
                {renderTopbar()}

                <div className={styles.contentArea}>
                    {quizStep === 'review' && quizResults ? (
                        // FULL DETAILED RESULTS VIEW
                        <div style={{ overflow: 'auto', height: '100%' }}>
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
                                    questions: quizResults.questions || []
                                }}
                            />
                        </div>
                    ) : isQuizIndex ? (
                        // QUIZ VIEW (intro / active)
                        <div className={`${styles.slideStage} ${styles.fadeEnter}`}>
                            <div className={styles.quizCard}>
                                <div className={styles.slideAccent} />
                                <div className={styles.quizInner}>
                                    {quizStep === 'intro' && (
                                        <div style={{ textAlign: 'center', marginTop: 40 }}>
                                            <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 16 }}>{course.quiz?.title}</h1>
                                            <p style={{ color: '#6B7280', marginBottom: 40, fontSize: 16 }}>
                                                This quiz contains {course.quiz?.questions.length} questions.<br />
                                                Passing score: {course.quiz?.passingScore}%
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
                                                    <span className={styles.slideModuleLabel}>Question {currentQuestionIndex + 1} of {course.quiz.questions.length}</span>
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
                    ) : (
                        // LESSON VIEW
                        viewMode === 'slides' ? (
                            <div className={`${styles.slideStage} ${styles.fadeEnter}`} key={activeIndex}>
                                <button className={`${styles.slideNav} ${styles.navPrev}`} onClick={handlePrev} disabled={activeIndex === 0}>
                                    <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg>
                                </button>

                                <div className={styles.slideCard}>
                                    <div className={styles.slideAccent} />
                                    <div className={styles.slideInner}>
                                        <div className={styles.slideMeta}>
                                            <span className={styles.slideModuleLabel}>Module {activeIndex + 1}</span>
                                            <span className={styles.slideCounter}>{activeIndex + 1} / {course.lessons.length}</span>
                                        </div>
                                        <h2 className={styles.slideTitle}>{currentLesson?.title?.replace(/^Module\s+\d+[:.]?\s*/i, '')}</h2>
                                        <div className={styles.slideDivider} />
                                        <SlideContentFitter
                                            className={styles.slideBody}
                                            content={currentLesson?.content || ''}
                                            minFontSize={12}
                                            maxFontSize={32}
                                        />
                                    </div>
                                </div>

                                <button className={`${styles.slideNav} ${styles.navNext}`} onClick={handleNext}>
                                    <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>
                                </button>
                            </div>
                        ) : (
                            // ARTICLE VIEW
                            <div className={`${styles.articleStage} ${styles.fadeEnter}`} key={activeIndex}>
                                <div className={styles.articlePaper}>
                                    <div className={styles.articleHeader}>
                                        <p className={styles.articleModuleLabel}>Module {activeIndex + 1}</p>
                                        <h1 className={styles.articleTitle}>{currentLesson?.title}</h1>
                                    </div>
                                    <div className={styles.articleDivider} />
                                    <div className={styles.articleContent} dangerouslySetInnerHTML={{ __html: currentLesson?.content || '' }} />

                                    <div className={styles.articleFooter}>
                                        <button className={styles.artNavBtn} onClick={handlePrev} disabled={activeIndex === 0}>
                                            <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg> Previous
                                        </button>
                                        <button className={styles.artNavBtn} onClick={handleNext}>
                                            Next <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )
                    )}
                </div>
            </div>

            {/* Modals */}
            {showQuizGateModal && renderQuizGateModal()}
            {showIncompleteModal && renderIncompleteModal()}
        </div>
    );
}
