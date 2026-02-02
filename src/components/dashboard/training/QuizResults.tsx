import React from 'react';
import styles from './QuizResults.module.css';
import Link from 'next/link';

interface QuizResultsProps {
    courseId: string;
    enrollmentId: string;
    data?: {
        courseName: string;
        score: number;
        answered: number;
        correct: number;
        wrong: number;
        time: number;
        userName?: string;
        questions: {
            id: string;
            text: string;
            options: { id: string; text: string }[];
            selectedAnswer: string;
            correctAnswer: string;
            explanation: string;
        }[];
    };
}

export default function QuizResults({ courseId, enrollmentId, data }: QuizResultsProps) {
    // Use provided data or fallback for demo/empty state
    const stats = data || {
        courseName: "Course",
        score: 0,
        answered: 0,
        correct: 0,
        wrong: 0,
        time: 0,
        questions: []
    };

    const questions = data?.questions || [];

    // Radial Progress Calculation
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (stats.score / 100) * circumference;
    const strokeColor = stats.score >= 70 ? '#00C55E' : '#E53E3E'; // Green or Red
    const isPassed = stats.score >= 70;

    return (
        <div className={styles.container}>
            <Link href={`/dashboard/training/courses/${courseId}`} className={styles.backLink}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                Back to Dashboard
            </Link>

            <div className={`${styles.headerCard} ${!isPassed ? styles.headerCardFailed : ''}`}>
                <div className={styles.headerTop}>
                    <div className={styles.headerTitle}>
                        {isPassed ? 'Nice work!' : 'Keep trying!'} You completed the <span className={styles.highlight}>[{stats.courseName}]</span> quiz in [{stats.time}] minutes.
                    </div>
                    <div className={styles.headerActions}>
                        <button className={`${styles.actionButton} ${styles.btnSecondary}`}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}>
                                <circle cx="18" cy="5" r="3"></circle>
                                <circle cx="6" cy="12" r="3"></circle>
                                <circle cx="18" cy="19" r="3"></circle>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                            </svg>
                            Share
                        </button>
                        <Link href={`/dashboard/training/courses/${courseId}`}>
                            <button className={`${styles.actionButton} ${styles.btnPrimary}`}>Done</button>
                        </Link>
                    </div>
                </div>

                <div className={styles.statsRow}>
                    {/* Grade Circle */}
                    <div className={styles.gradeCircle}>
                        <svg width="120" height="120" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r={radius} stroke="#E2E8F0" strokeWidth="8" fill="none" />
                            <circle
                                cx="60" cy="60" r={radius}
                                stroke={strokeColor}
                                strokeWidth="8"
                                fill="none"
                                strokeDasharray={circumference}
                                strokeDashoffset={offset}
                                strokeLinecap="round"
                                transform="rotate(-90 60 60)"
                            />
                        </svg>
                        <div style={{ position: 'absolute', textAlign: 'center' }}>
                            <div className={styles.gradeValue}>{stats.score}%</div>
                            <div className={styles.gradeLabel}>Grade</div>
                        </div>
                    </div>

                    {/* Stats Cards */}
                    <div className={`${styles.statsCard} ${styles.cardWhite}`}>
                        <span className={styles.cardValue}>{stats.answered}</span>
                        <span className={styles.cardLabel}>Quiz Answered</span>
                        <svg className={styles.cardIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                    </div>
                    <div className={`${styles.statsCard} ${styles.cardGreen}`}>
                        <span className={styles.cardValue}>{stats.correct}</span>
                        <span className={styles.cardLabel}>Correct Answers</span>
                        <svg className={styles.cardIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </div>
                    <div className={`${styles.statsCard} ${styles.cardRed}`}>
                        <span className={styles.cardValue}>{stats.wrong}</span>
                        <span className={styles.cardLabel}>Wrong Answers</span>
                        <svg className={styles.cardIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </div>
                </div>
            </div>

            {data?.userName && (
                <div className={styles.profileRow}>
                    <span>📚 Results for: {data.userName}</span>
                </div>
            )}

            <div className={styles.questionList}>
                <h2 className={styles.questionTitle}>Answers</h2>
                {questions.length === 0 ? (
                    <p style={{ color: '#718096', padding: 20 }}>No questions available.</p>
                ) : (
                    questions.map((q, index) => (
                        <div key={q.id} className={styles.questionCard}>
                            <div className={styles.questionText}>
                                <span>{index + 1}.</span> {q.text}
                            </div>
                            <div className={styles.optionList}>
                                {q.options.map(opt => {
                                    let optionClass = styles.option;
                                    let icon = null;
                                    // Correct Answer Logic
                                    if (opt.id === q.correctAnswer) {
                                        optionClass = `${styles.option} ${styles.optionCorrect}`;
                                        icon = (
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 'auto' }}>
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                        );
                                    }
                                    // Selected Wrong Logic
                                    if (opt.id === q.selectedAnswer && q.selectedAnswer !== q.correctAnswer) {
                                        optionClass = `${styles.option} ${styles.optionWrong}`;
                                        icon = (
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 'auto' }}>
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                            </svg>
                                        );
                                    }

                                    return (
                                        <div key={opt.id} className={optionClass}>
                                            <span className={styles.optionLabel}>{opt.id}.</span>
                                            {opt.text}
                                            {icon}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className={styles.explanation}>
                                <div className={styles.explanationTitle}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Correct Answer: {q.correctAnswer}
                                </div>
                                <div className={styles.explanationTitle} style={{ color: '#2F855A', fontSize: 14, marginTop: 8 }}>Explanation:</div>
                                <div className={styles.explanationText}>{q.explanation}</div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
