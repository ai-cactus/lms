'use client';

import React, { useState } from 'react';
import styles from './QuizResults.module.css';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import AttestationModal from './AttestationModal';
import BadgeSuccessModal from './BadgeSuccessModal';

interface QuizResultsProps {
  courseId: string;
  enrollmentId: string;
  hideActions?: boolean;
  showAttestation?: boolean; // Show attestation button
  onAttestSuccess?: () => void; // Callback after successful attestation
  onRetake?: () => void; // Callback for retake
  data?: {
    courseName: string;
    score: number;
    passingScore?: number;
    answered?: number;
    correct?: number;
    wrong?: number;
    time?: number;
    attemptsUsed?: number;
    allowedAttempts?: number | null;
    questions: {
      id: string;
      text: string;
      options: { id: string; text: string }[];
      selectedAnswer: string;
      correctAnswer: string;
      explanation: string;
    }[];
    userName?: string;
    userEmail?: string;
    jobTitle?: string;
  };
  userRole?: string;
  organizationName?: string;
}

export default function QuizResults({
  courseId,
  enrollmentId,
  hideActions = false,
  showAttestation = false,
  onAttestSuccess,
  onRetake,
  data,
  userRole = 'worker',
  organizationName,
}: QuizResultsProps) {
  const [isAttestationOpen, setIsAttestationOpen] = useState(false);
  const [isBadgeOpen, setIsBadgeOpen] = useState(false);

  // Use provided data or fallback for demo/empty state
  const stats = data || {
    courseName: 'Course',
    score: 0,
    answered: 0,
    correct: 0,
    wrong: 0,
    time: 0,
    questions: [],
  };

  const questions = data?.questions || [];

  // Radial Progress Calculation
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (stats.score / 100) * circumference;
  const passingScore = data?.passingScore || 70;
  const isPassed = stats.score >= passingScore;
  const strokeColor = isPassed ? '#00C55E' : '#E53E3E'; // Green or Red

  const handleAttestSuccess = () => {
    setIsAttestationOpen(false);
    setIsBadgeOpen(true); // Open badge modal
    if (onAttestSuccess) onAttestSuccess();
  };

  // Retake Logic
  const attemptsUsed = data?.attemptsUsed || 1;
  const allowedAttempts = data?.allowedAttempts || null;
  const canRetake = !isPassed && (allowedAttempts === null || attemptsUsed < allowedAttempts);

  // Callback for retake
  const handleRetake = () => {
    if (onRetake) {
      onRetake();
    }
  };

  const dashboardPath = userRole === 'admin' ? '/dashboard' : '/worker';

  return (
    <div className={styles.container}>
      <Link href={dashboardPath} className={styles.backLink}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Dashboard
      </Link>
      <div className={`${styles.headerCard} ${!isPassed ? styles.headerCardFailed : ''}`}>
        <div className={styles.headerTop}>
          <div className={styles.headerTitle}>
            {isPassed ? 'Nice work!' : 'Keep trying!'} You completed the{' '}
            <span className={styles.highlight}>{stats.courseName}</span> quiz in{' '}
            {Math.ceil((stats.time || 0) / 60)} minutes.
            {!isPassed && allowedAttempts && (
              <div style={{ fontSize: 13, marginTop: 4, fontWeight: 400, color: '#E53E3E' }}>
                Attempt {attemptsUsed} of {allowedAttempts}
              </div>
            )}
          </div>
          {!hideActions && (
            <div
              className={styles.headerActions}
              style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
            >
              {showAttestation && isPassed && (
                <Button variant="primary" size="sm" onClick={() => setIsAttestationOpen(true)}>
                  Attestate
                </Button>
              )}
              {canRetake && (
                <Button variant="outline" size="sm" onClick={handleRetake}>
                  Retake Quiz
                </Button>
              )}
              {isPassed && (
                <Link href={dashboardPath}>
                  <Button variant="primary" size="sm">
                    Done
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>

        <div className={styles.statsRow}>
          {/* Grade Circle */}
          <div className={styles.gradeCircle}>
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r={radius} stroke="#E2E8F0" strokeWidth="8" fill="none" />
              <circle
                cx="60"
                cy="60"
                r={radius}
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
            <svg
              className={styles.cardIcon}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#718096"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </div>
          <div className={`${styles.statsCard} ${styles.cardGreen}`}>
            <span className={styles.cardValue}>{stats.correct}</span>
            <span className={styles.cardLabel}>Correct Answers</span>
            <svg
              className={styles.cardIcon}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </div>
          <div className={`${styles.statsCard} ${styles.cardRed}`}>
            <span className={styles.cardValue}>{stats.wrong}</span>
            <span className={styles.cardLabel}>Wrong Answers</span>
            <svg
              className={styles.cardIcon}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
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
                {q.options.map((opt, i) => {
                  // Only highlight the option the worker selected AND got wrong.
                  // We intentionally do NOT reveal which option is correct (Option B behaviour).
                  const isSelectedWrong =
                    opt.id === q.selectedAnswer && q.selectedAnswer !== q.correctAnswer;
                  const isSelectedCorrect =
                    opt.id === q.selectedAnswer && q.selectedAnswer === q.correctAnswer;

                  let optionClass = styles.option;
                  let icon = null;

                  if (isSelectedCorrect) {
                    // Worker got it right — subtle positive indicator on their selection only
                    optionClass = `${styles.option} ${styles.optionCorrect}`;
                    icon = (
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{ marginLeft: 'auto' }}
                      >
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    );
                  } else if (isSelectedWrong) {
                    // Worker got it wrong — show their selection in red; correct answer stays neutral
                    optionClass = `${styles.option} ${styles.optionWrong}`;
                    icon = (
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{ marginLeft: 'auto' }}
                      >
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    );
                  }

                  return (
                    <div key={i} className={optionClass}>
                      <span className={styles.optionLabel}>{opt.id}.</span>
                      {opt.text}
                      {icon}
                    </div>
                  );
                })}
              </div>
              {q.explanation && (
                <div className={styles.explanation}>
                  <div
                    className={styles.explanationTitle}
                    style={{ color: '#2F855A', fontSize: 14 }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    &nbsp;Explanation
                  </div>
                  <div className={styles.explanationText}>{q.explanation}</div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <AttestationModal
        isOpen={isAttestationOpen}
        onClose={() => setIsAttestationOpen(false)}
        enrollmentId={enrollmentId}
        courseName={stats.courseName}
        userName={data?.userName || 'User'}
        userEmail={data?.userEmail || ''}
        jobTitle={data?.jobTitle || ''}
        onSuccess={handleAttestSuccess}
      />

      <BadgeSuccessModal
        isOpen={isBadgeOpen}
        onClose={() => setIsBadgeOpen(false)}
        courseName={stats.courseName}
        organizationName={organizationName || 'N/A'}
        issuedDate={new Date().toLocaleDateString()}
        courseId={courseId}
      />
    </div>
  );
}
