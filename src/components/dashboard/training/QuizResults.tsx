'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil, Star, Check, X, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CircularProgress from '@/components/ui/CircularProgress';
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
    <div className="mx-auto max-w-[1000px] p-6">
      <Link
        href={dashboardPath}
        className="mb-6 flex cursor-pointer items-center gap-2 text-sm text-text-secondary no-underline"
      >
        <ArrowLeft className="size-4" />
        Back to Dashboard
      </Link>

      <div
        className={`relative mb-8 overflow-hidden rounded-2xl p-8 ${
          isPassed ? 'bg-success/10' : 'bg-error/10'
        }`}
      >
        <div className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row">
          <div className="text-2xl font-bold leading-snug text-foreground md:max-w-[60%]">
            {isPassed ? 'Nice work!' : 'Keep trying!'} You completed the{' '}
            <span className="text-primary">{stats.courseName}</span> quiz in{' '}
            {Math.ceil((stats.time || 0) / 60)} minutes.
            {!isPassed && allowedAttempts && (
              <div className="mt-1 text-[13px] font-normal text-error">
                Attempt {attemptsUsed} of {allowedAttempts}
              </div>
            )}
          </div>
          {!hideActions && (
            <div className="flex items-center gap-2">
              {showAttestation && isPassed && (
                <Button variant="default" size="sm" onClick={() => setIsAttestationOpen(true)}>
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
                  <Button variant="default" size="sm">
                    Done
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="relative z-[2] flex flex-col items-center gap-6 sm:flex-row">
          {/* Grade Circle */}
          <div className="flex size-[120px] shrink-0 items-center justify-center">
            <CircularProgress
              percentage={stats.score}
              size={120}
              strokeWidth={8}
              color={strokeColor}
              label="Grade"
            />
          </div>

          {/* Stats Cards */}
          <div className="flex w-full flex-1 flex-col gap-4 sm:flex-row">
            <div className="relative flex min-h-20 flex-1 flex-col justify-center rounded-xl bg-background p-4 px-5 text-foreground shadow-sm">
              <span className="mb-1 block text-2xl font-bold">{stats.answered}</span>
              <span className="text-[13px] font-semibold">Questions Answered</span>
              <Pencil className="absolute right-4 top-4 size-4 text-text-muted" />
            </div>
            <div className="relative flex min-h-20 flex-1 flex-col justify-center rounded-xl bg-[#00c55e] p-4 px-5 text-white shadow-sm">
              <span className="mb-1 block text-2xl font-bold">{stats.correct}</span>
              <span className="text-[13px] font-semibold">Correct Answers</span>
              <Star className="absolute right-4 top-4 size-4 fill-white text-white" />
            </div>
            <div className="relative flex min-h-20 flex-1 flex-col justify-center rounded-xl bg-error p-4 px-5 text-white shadow-sm">
              <span className="mb-1 block text-2xl font-bold">{stats.wrong}</span>
              <span className="text-[13px] font-semibold">Wrong Answers</span>
              <Star className="absolute right-4 top-4 size-4 fill-white text-white" />
            </div>
          </div>
        </div>
      </div>

      {data?.userName && (
        <div className="mb-8 flex items-center gap-3 rounded-[50px] border border-border bg-background px-6 py-3 text-sm text-text-muted">
          <span>📚 Results for: {data.userName}</span>
        </div>
      )}

      <div className="flex flex-col gap-6">
        <h2 className="mb-6 text-xl font-bold text-foreground">Answers</h2>
        {questions.length === 0 ? (
          <p className="p-5 text-text-muted">No questions available.</p>
        ) : (
          questions.map((q, index) => (
            <div key={q.id} className="mb-8">
              <div className="mb-4 flex gap-3 text-base font-semibold text-foreground">
                <span>{index + 1}.</span> {q.text}
              </div>
              <div className="flex flex-col gap-3">
                {q.options.map((opt, i) => {
                  const isCorrectAnswer = opt.id === q.correctAnswer;
                  const isSelectedWrong =
                    opt.id === q.selectedAnswer && q.selectedAnswer !== q.correctAnswer;
                  const isSelectedCorrect =
                    opt.id === q.selectedAnswer && q.selectedAnswer === q.correctAnswer;

                  let optionClass =
                    'flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm text-text-secondary';
                  let icon = null;

                  if (isSelectedCorrect) {
                    // Worker selected the correct answer — highlight green
                    optionClass =
                      'flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success';
                    icon = <Check className="ml-auto size-5" />;
                  } else if (isSelectedWrong) {
                    // Worker selected the wrong answer — highlight red
                    optionClass =
                      'flex items-center gap-3 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error';
                    icon = <X className="ml-auto size-5" />;
                  } else if (isCorrectAnswer) {
                    // This is the correct answer and the worker did NOT select it —
                    // highlight it green so they know the right answer during review.
                    optionClass =
                      'flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success';
                    icon = <Check className="ml-auto size-5" />;
                  }

                  return (
                    <div key={i} className={optionClass}>
                      <span className="mr-2 font-semibold">{opt.id}.</span>
                      {opt.text}
                      {icon}
                    </div>
                  );
                })}
              </div>
              {q.explanation && (
                <div className="mt-4 rounded-lg border-l-4 border-success bg-success/10 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold text-success">
                    <Info className="size-3.5" />
                    &nbsp;Explanation
                  </div>
                  <div className="text-sm leading-normal text-foreground">{q.explanation}</div>
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
        userEmail={data?.userEmail || ''}
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
