'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import styles from './learn.module.css';
import QuizResults from '@/components/dashboard/training/QuizResults';
import AttestationModal from '@/components/dashboard/training/AttestationModal';
import BadgeSuccessModal from '@/components/dashboard/training/BadgeSuccessModal';
import CircularProgress from '@/components/ui/CircularProgress';

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

    // Flow State
    const [viewMode, setViewMode] = useState<'lesson' | 'notes' | 'quiz_intro' | 'quiz_active' | 'quiz_results'>('lesson');
    const [currentLessonIndex, setCurrentLessonIndex] = useState(0);

    // Quiz State
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
    const [timeLeft, setTimeLeft] = useState(90); // 90 seconds per quiz? Or per question? Design implies total.
    const [isChecking, setIsChecking] = useState(false);
    const [quizResults, setQuizResults] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);

    // Attestation State
    const [showAttestation, setShowAttestation] = useState(false);
    const [showBadge, setShowBadge] = useState(false);

    useEffect(() => {
        fetchCourseData();
    }, [courseId]);

    // Timer Effect
    useEffect(() => {
        if (viewMode === 'quiz_active' && timeLeft > 0) {
            const timer = setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        handleSubmitQuiz(); // Auto-submit on timeout
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [viewMode, timeLeft]);

    const fetchCourseData = async () => {
        try {
            const res = await fetch(`/api/courses/${courseId}/learn`);
            if (!res.ok) throw new Error('Failed to load course');
            const data = await res.json();
            setCourse(data.course);
            setEnrollment(data.enrollment);
            setUserData(data.user);

            // Restore state if completed
            if (data.enrollment?.status === 'completed' || data.enrollment?.status === 'attested') {
                setViewMode('quiz_results');
                // Mock result if we don't have it (or could fetch it)
                setQuizResults({ passed: true, score: data.enrollment.score || 100, correctCount: 5, totalQuestions: 5 });
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleNextLesson = () => {
        if (!course) return;

        if (currentLessonIndex < course.lessons.length - 1) {
            setCurrentLessonIndex(currentLessonIndex + 1);
            updateProgress();
        } else if (course.quiz) {
            setViewMode('quiz_intro');
        }
    };

    const handlePrevLesson = () => {
        if (currentLessonIndex > 0) {
            setCurrentLessonIndex(currentLessonIndex - 1);
        }
    };

    const updateProgress = async () => {
        if (!course || !enrollment) return;
        const progress = Math.round(((currentLessonIndex + 1) / course.lessons.length) * 100);
        try {
            await fetch(`/api/enrollments/${enrollment.id}/progress`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ progress })
            });
        } catch (err) {
            console.error('Failed to update progress', err);
        }
    };

    // Quiz Handlers
    const handleStartQuiz = () => {
        setViewMode('quiz_active');
        setCurrentQuestionIndex(0);
        // Prioritize explicit timeLimit. If null/0, fallback to question count estimate (1 min/q) or default 5 mins
        const limitSeconds = course?.quiz?.timeLimit
            ? course.quiz.timeLimit * 60
            : (course?.quiz?.questions.length ? course.quiz.questions.length * 60 : 300);

        setTimeLeft(limitSeconds);
        setQuizAnswers({});
    };

    const handleOptionSelect = (option: string) => {
        if (isChecking) return; // Prevent changing after checking
        if (!course?.quiz) return;

        const questionId = course.quiz.questions[currentQuestionIndex].id;
        setQuizAnswers(prev => ({ ...prev, [questionId]: option }));
    };

    const handleCheckAnswer = () => {
        setIsChecking(true);
    };

    const handleNextQuestion = () => {
        if (!course?.quiz) return;

        if (currentQuestionIndex < course.quiz.questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
            setIsChecking(false);
        } else {
            handleSubmitQuiz();
        }
    };

    const handleSubmitQuiz = async () => {
        if (!course?.quiz || !enrollment) return;
        setSubmitting(true);

        const answers = Object.entries(quizAnswers).map(([questionId, selectedAnswer]) => ({
            questionId,
            selectedAnswer
        }));

        const timeTaken = (course.quiz.questions.length * 60) - timeLeft; // Approximate

        try {
            const res = await fetch(`/api/quiz/${course.quiz.id}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enrollmentId: enrollment.id,
                    answers,
                    timeTaken: timeTaken > 0 ? timeTaken : 0
                })
            });

            if (!res.ok) throw new Error('Failed to submit quiz');

            const result = await res.json();
            setQuizResults(result);
            setViewMode('quiz_results');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleRetakeQuiz = () => {
        setQuizAnswers({});
        setQuizResults(null);
        setViewMode('quiz_intro');
    };

    const handleAttestationSuccess = () => {
        setShowAttestation(false);
        setShowBadge(true);
        if (enrollment) {
            setEnrollment({ ...enrollment, status: 'attested' });
        }
    };

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    if (loading) return <div className={styles.loadingState}><div className={styles.spinner}></div><p>Loading...</p></div>;
    if (error) return <div className={styles.errorState}><h2>Error</h2><p>{error}</p><button onClick={() => router.back()}>Go Back</button></div>;
    if (!course) return null;

    // View: Quiz Results
    if (viewMode === 'quiz_results' && quizResults) {
        return (
            <div className={styles.container}>
                <header className={styles.header}>
                    <div className={styles.headerProgress}>
                        <button className={styles.backLink} onClick={() => router.back()}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                        </button>
                        <div className={styles.progressInfo}>
                            <span className={styles.progressSub}>Trainings</span>
                            <span className={styles.progressTitle}>{course.title}</span>
                        </div>
                    </div>
                </header>
                <div className={styles.resultsWrapper} style={{ marginTop: 40 }}>
                    <div className={styles.resultsHeader}>
                        <h1>{course.title}</h1>
                        <p className={quizResults.passed ? styles.passed : styles.failed}>
                            {quizResults.passed ? '🎉 You Passed!' : '❌ Not Passed'}
                        </p>
                    </div>
                    <div className={styles.scoreCard}>
                        <div className={styles.scoreCircle}>
                            <span className={styles.scoreNumber}>{quizResults.score}%</span>
                            <span className={styles.scoreLabel}>Score</span>
                        </div>
                        <div className={styles.scoreDetails}>
                            <div><strong>{quizResults.correctCount}</strong> Correct</div>
                            <div><strong>{quizResults.totalQuestions - quizResults.correctCount}</strong> Incorrect</div>
                            <div>Pass Mark: {course.quiz?.passingScore}%</div>
                        </div>
                    </div>
                    <div className={styles.resultsActions}>
                        {!quizResults.passed ? (
                            (() => {
                                const attemptsUsed = (enrollment?.quizAttempts?.length || 0) + 1; // +1 because we just finished one but maybe state not updated yet? 
                                // Actually enrollment state might be stale until re-fetch. But let's use safe check.
                                // Better to trust backend, but for UI feedback:
                                const allowed = course.quiz?.allowedAttempts;
                                const hasRemaining = allowed === null || allowed === undefined || (enrollment?.quizAttempts?.length || 0) < allowed;
                                // Wait, simple logic: if we just failed, can we retake?
                                // We need accurate count. Let's rely on what we have.

                                return hasRemaining ? (
                                    <button className={styles.retakeBtn} onClick={handleRetakeQuiz}>Retake Quiz</button>
                                ) : (
                                    <button className={styles.retakeBtn} disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>No Attempts Left</button>
                                );
                            })()
                        ) : (
                            <button className={styles.attestBtn} style={{ background: '#4C6EF5', color: 'white', border: 'none', padding: '12px 32px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }} onClick={() => setShowAttestation(true)}>Attestate</button>
                        )}
                        {!quizResults.passed && <button className={styles.backBtn} onClick={() => router.push('/worker')}>Back to Dashboard</button>}
                    </div>
                </div>
                {course && enrollment && userData && (
                    <AttestationModal isOpen={showAttestation} onClose={() => setShowAttestation(false)} enrollmentId={enrollment.id} courseName={course.title} userName={userData.name} userRole={userData.role} onSuccess={handleAttestationSuccess} />
                )}
                {course && (
                    <BadgeSuccessModal isOpen={showBadge} onClose={() => setShowBadge(false)} courseName={course.title} organizationName="Theraptly" issuedDate={new Date().toLocaleDateString()} />
                )}
            </div>
        );
    }

    // View: Question (Active Quiz) - Keeping mostly same but updating header
    if (viewMode === 'quiz_active' && course.quiz) {
        const question = course.quiz.questions[currentQuestionIndex];
        const selectedOption = quizAnswers[question.id];
        const isLastQuestion = currentQuestionIndex === course.quiz.questions.length - 1;

        return (
            <div className={styles.container}>
                <header className={styles.header}>
                    <div className={styles.headerProgress}>
                        <button className={styles.backLink} onClick={() => setViewMode('quiz_intro')}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                        </button>
                        <div className={styles.progressInfo}>
                            <span className={styles.progressSub}>Quiz Attempt</span>
                            <span className={styles.progressTitle}>{course.title}</span>
                        </div>
                    </div>
                </header>
                <div className={styles.quizContainer}>
                    <div className={styles.quizHeader}>
                        <h2 className={styles.questionStep}>Quiz: {course.quiz.title}</h2>
                        <div className={styles.timerBadge}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            {formatTime(timeLeft)}
                        </div>
                    </div>

                    <div className={styles.questionCard}>
                        <h3 className={styles.stepQuestion}>{currentQuestionIndex + 1}. {question.text}</h3>
                        <div className={styles.optionsGrid}>
                            {question.options.map((option, idx) => {
                                const isSelected = selectedOption === option;
                                const isCorrect = question.correctAnswer === option;

                                let statusClass = '';
                                if (isSelected) statusClass = styles.selected;
                                if (isChecking) {
                                    if (isCorrect) statusClass = styles.correct;
                                    else if (isSelected && !isCorrect) statusClass = styles.incorrect;
                                }

                                return (
                                    <div
                                        key={idx}
                                        className={`${styles.optionBox} ${statusClass}`}
                                        onClick={() => handleOptionSelect(option)}
                                    >
                                        <div className={styles.optionLetter}>{String.fromCharCode(65 + idx)}</div>
                                        <span className={styles.optionText}>{option}</span>
                                        {isChecking && isCorrect && <span style={{ marginLeft: 'auto', color: '#48BB78', fontWeight: 'bold' }}>✓</span>}
                                        {isChecking && isSelected && !isCorrect && <span style={{ marginLeft: 'auto', color: '#F56565', fontWeight: 'bold' }}>✗</span>}
                                    </div>
                                );
                            })}
                        </div>

                        <div className={styles.quizActions}>
                            {!isChecking ? (
                                <button className={styles.checkAnswerBtn} onClick={handleCheckAnswer} disabled={!selectedOption}>Check Answer</button>
                            ) : (
                                <button className={styles.nextQuestionBtn} onClick={handleNextQuestion}>
                                    {isLastQuestion ? 'Submit Quiz' : 'Next Question'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // View: Quiz Intro (New Design)
    if (viewMode === 'quiz_intro' && course.quiz) {
        return (
            <div className={styles.container}>
                <header className={styles.header}>
                    <div className={styles.headerProgress}>
                        <button className={styles.backLink} onClick={() => setViewMode('lesson')}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                        </button>
                        <div className={styles.progressInfo}>
                            <span className={styles.progressSub}>Trainings / {course.title}</span>
                            <span className={styles.progressTitle}>Quiz Overview</span>
                        </div>
                    </div>
                </header>

                <div className={styles.quizIntroLayout}>
                    <div className={styles.quizIntroMain}>
                        <h1 className={styles.introTitle} style={{ textAlign: 'left', marginBottom: 8 }}>Quiz 1: {course.quiz.title}</h1>
                        <span style={{ color: '#718096', fontSize: 14, display: 'block', marginBottom: 32 }}>({course.quiz.questions.length} Questions)</span>

                        {(() => {
                            const attemptsUsed = enrollment?.quizAttempts?.length || 0;
                            const allowed = course.quiz.allowedAttempts;
                            const hasRemaining = allowed === null || attemptsUsed < allowed;

                            return (
                                <div style={{ marginBottom: 24 }}>
                                    <div className={styles.gradeBox} style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                                        <div className={styles.gradeItem}>
                                            <h4>Pass Grade</h4>
                                            <p style={{ color: '#4F46E5' }}>{course.quiz.passingScore}%</p>
                                        </div>
                                        <div className={styles.gradeItem}>
                                            <h4>Time Limit</h4>
                                            <p>{course.quiz.timeLimit ? `${course.quiz.timeLimit} min` : 'None'}</p>
                                        </div>
                                        <div className={styles.gradeItem} style={{ textAlign: 'right' }}>
                                            <h4>Attempts</h4>
                                            <p>{allowed === null ? 'Unlimited' : `${attemptsUsed} / ${allowed}`}</p>
                                        </div>
                                    </div>

                                    {!hasRemaining ? (
                                        <div style={{ marginTop: 24, padding: 16, background: '#FFF5F5', color: '#C53030', borderRadius: 8, textAlign: 'center' }}>
                                            Maximum attempts reached.
                                        </div>
                                    ) : (
                                        <button className={styles.startQuizBtn} onClick={handleStartQuiz} style={{ width: 'fit-content', padding: '12px 32px', marginTop: 24 }}>
                                            Start Quiz
                                        </button>
                                    )}
                                </div>
                            );
                        })()}
                    </div>

                    <aside className={styles.quizIntroSidebar}>
                        <h3 className={styles.tocTitle}>Table of Content</h3>
                        <ul className={styles.tocList}>
                            {course.lessons.map((l, i) => (
                                <li key={l.id} className={styles.tocItem}>{l.title}</li>
                            ))}
                            <li className={styles.tocItem} style={{ color: '#4F46E5', fontWeight: 600 }}>Course Quiz</li>
                        </ul>
                    </aside>
                </div>
            </div>
        );
    }

    // View: Notes (Article Mode)
    if (viewMode === 'notes') {
        const currentLesson = course.lessons[currentLessonIndex];
        const progress = Math.round(((currentLessonIndex + 1) / course.lessons.length) * 100);

        return (
            <div className={styles.container}>
                <header className={styles.header}>
                    <button className={styles.backLink} onClick={() => router.push('/worker')}>← Back</button>
                    <h1>{course.title}</h1>
                    <div className={styles.progressBar}>
                        <div className={styles.progressFill} style={{ width: `${progress}%` }}></div>
                    </div>
                </header>

                <div className={styles.layout}>
                    <aside className={styles.sidebar}>
                        <h3>Lessons</h3>
                        <ul className={styles.lessonList}>
                            {course.lessons.map((lesson, idx) => (
                                <li key={lesson.id} className={`${styles.lessonItem} ${idx === currentLessonIndex ? styles.active : ''} ${idx < currentLessonIndex ? styles.completed : ''}`} onClick={() => setCurrentLessonIndex(idx)}>
                                    <span className={styles.lessonNumber}>{idx + 1}</span>
                                    <span className={styles.lessonTitle}>{lesson.title}</span>
                                    {idx < currentLessonIndex && <span className={styles.checkmark}>✓</span>}
                                </li>
                            ))}
                        </ul>
                    </aside>
                    <main className={styles.content}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                            <button className={styles.viewModeBtn} onClick={() => setViewMode('lesson')}>
                                View as Slides
                            </button>
                        </div>
                        <div className={styles.lessonHeader}>
                            <span className={styles.lessonBadge}>Lesson {currentLessonIndex + 1}</span>
                            <h2>{currentLesson.title}</h2>
                            {currentLesson.duration && <span className={styles.duration}>{currentLesson.duration} min</span>}
                        </div>
                        <div className={styles.lessonContent} dangerouslySetInnerHTML={{ __html: currentLesson.content }} />
                        <div className={styles.lessonFooter}>
                            <button className={styles.prevBtn} onClick={handlePrevLesson} disabled={currentLessonIndex === 0}>Previous</button>
                            <button className={styles.nextBtn} onClick={handleNextLesson}>{currentLessonIndex === course.lessons.length - 1 ? (course.quiz ? 'Take Quiz' : 'Finish') : 'Next Lesson'}</button>
                        </div>
                    </main>
                </div>
            </div>
        );
    }

    // View: Lesson (Slide Deck Mode)
    const currentLesson = course.lessons[currentLessonIndex];
    const progress = Math.round(((currentLessonIndex + 1) / course.lessons.length) * 100);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.headerProgress}>
                    <CircularProgress percentage={progress} size={48} />
                    <div className={styles.progressInfo}>
                        <span className={styles.progressSub}>Trainings / {course.title}</span>
                        <span className={styles.progressTitle}>Your Progress: {currentLessonIndex + 1} of {course.lessons.length} Completed</span>
                    </div>
                </div>
                <div style={{ flex: 1 }}></div>

                <button className={styles.viewModeBtn} onClick={() => setViewMode('notes')}>
                    View as Notes
                </button>

                {/* User Profile Dropdown Placeholder */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 24, paddingLeft: 24, borderLeft: '1px solid #E2E8F0' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#CBD5E0', overflow: 'hidden' }}>
                        {/* Avatar image would go here */}
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
                            {userData?.name.charAt(0)}
                        </div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{userData?.name.split(' ')[0]}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </div>
            </header>

            {/* Slide Layout */}
            <div className={styles.slideDeckContainer}>
                <div className={styles.slideCardWrapper}>
                    <button
                        className={styles.slideNavBtn}
                        onClick={handlePrevLesson}
                        disabled={currentLessonIndex === 0}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                    </button>

                    <div className={styles.slideMain}>
                        <h2 style={{ fontSize: '3rem', fontWeight: 800, marginBottom: '1.5rem', lineHeight: 1.1 }}>{currentLesson.title}</h2>
                        {/* Render slide content properly */}
                        <div dangerouslySetInnerHTML={{ __html: currentLesson.content }} style={{ fontSize: '1.25rem', lineHeight: 1.6, color: '#4A5568' }} />

                        <div style={{ marginTop: 'auto', paddingTop: 32, paddingBottom: 16, borderTop: '1px solid #E2E8F0', fontSize: 13, color: '#A0AEC0', textAlign: 'center' }}>
                            www.theraptly.com
                        </div>
                    </div>

                    <button
                        className={styles.slideNavBtn}
                        onClick={handleNextLesson}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                    </button>
                </div>

                {/* Thumbnails */}
                <div className={styles.thumbnailsStrip}>
                    {course.lessons.map((lesson, idx) => (
                        <div
                            key={lesson.id}
                            className={`${styles.thumbnail} ${idx === currentLessonIndex ? styles.active : ''}`}
                            onClick={() => setCurrentLessonIndex(idx)}
                        >
                            <div className={styles.thumbContent}>
                                <strong>{lesson.title}</strong>
                                <div dangerouslySetInnerHTML={{ __html: lesson.content.substring(0, 50) + '...' }} />
                            </div>
                        </div>
                    ))}
                    {/* Quiz Thumbnail */}
                    {course.quiz && (
                        <div
                            className={styles.thumbnail}
                            onClick={() => setViewMode('quiz_intro')}
                        >
                            <div className={styles.thumbContent} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                <strong>Quiz</strong>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}


