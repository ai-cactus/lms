'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import styles from './LearnerRedesign.module.css'; // New CSS
import { Button } from '@/components/ui';
import SlideContentFitter from '@/components/ui/SlideContentFitter';

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
    // Using index to track position: 0 to N-1 are lessons, N is Quiz Intro, N+1 is Active Quiz, N+2 is Results
    const [activeIndex, setActiveIndex] = useState(0);

    // Quiz State
    const [isQuizActive, setIsQuizActive] = useState(false);
    const [quizStep, setQuizStep] = useState<'intro' | 'active' | 'results'>('intro');
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
    const [timeLeft, setTimeLeft] = useState(0);
    const [quizResults, setQuizResults] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);

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

                // Restore state
                if (data.enrollment?.status === 'completed' || data.enrollment?.status === 'attested') {
                    // Go to results directly if done
                    setQuizResults({ passed: true, score: data.enrollment.score || 100 });
                    // Index for quiz is lessons.length
                    if (data.course.lessons) setActiveIndex(data.course.lessons.length);
                    setIsQuizActive(true);
                    setQuizStep('results');
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

    // Navigation Handlers
    const handleNavClick = (index: number) => {
        if (!course) return;
        // If index is the quiz index (lessons.length)
        if (index === course.lessons.length) {
            setIsQuizActive(true);
            // If we have results, go to results, else intro
            if (quizResults) setQuizStep('results');
            else setQuizStep('intro');
        } else {
            setIsQuizActive(false);
        }
        setActiveIndex(index);
        updateProgress(index);
    };

    const handleNext = () => {
        if (!course) return;
        const maxIndex = course.lessons.length + (course.quiz ? 0 : -1);
        // Note: Logic simplifies if we treat Quiz as just another index

        if (activeIndex < course.lessons.length) {
            handleNavClick(activeIndex + 1);
        }
    };

    const handlePrev = () => {
        if (activeIndex > 0) {
            handleNavClick(activeIndex - 1);
        }
    };

    const updateProgress = async (idx: number) => {
        if (!course || !enrollment) return;
        if (idx >= course.lessons.length) return; // Don't update progress for quiz steps here

        const progress = Math.round(((idx + 1) / course.lessons.length) * 100);
        // Only update if greater (simple logic, optional)
        if (progress > enrollment.progress) {
            try {
                await fetch(`/api/enrollments/${enrollment.id}/progress`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ progress })
                });
            } catch (err) {
                console.error('Failed to update progress', err);
            }
        }
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
                    timeTaken: 0 // Calc real time if needed
                })
            });
            if (!res.ok) throw new Error('Failed to submit');
            const result = await res.json();
            setQuizResults(result);
            setQuizStep('results');
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

    // Render Helpers
    const renderSidebar = () => (
        <nav className={styles.rail}>
            <div className={styles.railLogo} onClick={() => router.push('/dashboard/worker')}>
                <svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
            </div>
            {course.lessons.map((l, i) => (
                <button
                    key={l.id}
                    className={`${styles.modDot} ${i === activeIndex ? styles.modDotActive : i < activeIndex ? styles.modDotDone : ''}`}
                    onClick={() => handleNavClick(i)}
                    title={l.title}
                >
                    {i + 1}
                </button>
            ))}
            {course.quiz && (
                <button
                    className={`${styles.modDot} ${styles.modDotQuiz} ${isQuizIndex ? styles.modDotQuizActive : ''}`}
                    onClick={() => handleNavClick(course.lessons.length)}
                    title="Quiz"
                >
                    Q
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
        </header>
    );

    return (
        <div className={styles.app}>
            {renderSidebar()}

            <div className={styles.main}>
                {renderTopbar()}

                <div className={styles.contentArea}>
                    {isQuizIndex ? (
                        // QUIZ VIEW
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
                                                <button className={styles.btnPrimary} onClick={handleNextQuestion}>
                                                    {currentQuestionIndex === course.quiz.questions.length - 1 ? (submitting ? 'Submitting...' : 'Submit Quiz') : 'Next Question'}
                                                </button>
                                            </div>
                                        </>
                                    )}

                                    {quizStep === 'results' && quizResults && (
                                        <div style={{ textAlign: 'center', marginTop: 40 }}>
                                            <div style={{ fontSize: 64, marginBottom: 16 }}>{quizResults.passed ? '🎉' : '😕'}</div>
                                            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{quizResults.passed ? 'You Passed!' : 'Course Not Passed'}</h2>
                                            <p style={{ fontSize: 18, color: '#4B5563', marginBottom: 32 }}>
                                                You scored <strong>{quizResults.score}%</strong>
                                            </p>
                                            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                                                {!quizResults.passed && <button className={styles.btnPrimary} onClick={handleRetake}>Retake Quiz</button>}
                                                <button className={styles.btnPrimary} style={{ background: 'white', color: '#1a1a1a', border: '1px solid #E5E7EB' }} onClick={() => router.push('/dashboard/worker')}>Return to Dashboard</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        // LESSON VIEW
                        viewMode === 'slides' ? (
                            <div className={`${styles.slideStage} ${styles.fadeEnter}`}>
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
                                        <h2 className={styles.slideTitle}>{currentLesson?.title?.replace(/^Module\s+\d+[:.]\s*/i, '')}</h2>
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
                            <div className={`${styles.articleStage} ${styles.fadeEnter}`}>
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
        </div>
    );
}
