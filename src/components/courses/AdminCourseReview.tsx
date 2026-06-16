'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VideoPlayer } from '@/components/video/VideoPlayer';

export interface AdminReviewQuestion {
  id: string;
  text: string;
  options: string[];
  correctAnswer: string;
  explanation?: string;
}

export interface AdminReviewQuiz {
  title: string;
  passingScore: number;
  questions: AdminReviewQuestion[];
}

interface AdminCourseReviewProps {
  courseId: string;
  title: string;
  videoLesson: { id: string; title: string } | null;
  enrollmentId: string;
  quiz: AdminReviewQuiz | null;
}

export default function AdminCourseReview({
  courseId,
  title,
  videoLesson,
  enrollmentId,
  quiz,
}: AdminCourseReviewProps) {
  const [index, setIndex] = useState(0);

  const questions = quiz?.questions ?? [];
  const total = questions.length;
  const current = questions[index];

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      {/* Top bar */}
      <header className="flex h-16 items-center justify-between border-b border-border bg-white px-6">
        <Link
          href={`/dashboard/training/courses/${courseId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to course
        </Link>
        <Link href={`/dashboard/training/courses/${courseId}/assign`}>
          <Button size="sm">
            <Share2 className="size-4" aria-hidden="true" />
            Assign
          </Button>
        </Link>
      </header>

      <div className="mx-auto w-full max-w-[900px] px-6 py-8">
        <h1 className="mb-6 text-2xl font-bold text-[#1a202c]">{title}</h1>

        {/* Course video */}
        {videoLesson ? (
          <div className="mb-10">
            <VideoPlayer lessonId={videoLesson.id} enrollmentId={enrollmentId} />
          </div>
        ) : (
          <p className="mb-10 text-sm text-text-secondary">This course has no video.</p>
        )}

        {/* Read-only quiz walkthrough */}
        {total > 0 && current ? (
          <div className="rounded-xl border border-border bg-white p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#1a202c]">{quiz?.title || 'Quiz'}</h2>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Answer key · Pass mark {quiz?.passingScore ?? 0}%
                </p>
              </div>
              <span className="text-sm font-semibold text-text-secondary">
                Question {index + 1} of {total}
              </span>
            </div>

            <h3 className="mb-4 text-lg font-semibold text-foreground">{current.text}</h3>

            <ul className="flex flex-col gap-3">
              {current.options.map((opt, i) => {
                const isCorrect = opt === current.correctAnswer;
                return (
                  <li
                    key={i}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
                      isCorrect
                        ? 'border-[#48bb78] bg-[#f0fff4] font-semibold text-[#22543d]'
                        : 'border-border bg-white text-[#374151]'
                    }`}
                  >
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                        isCorrect ? 'bg-[#48bb78] text-white' : 'bg-[#f3f4f6] text-[#6b7280]'
                      }`}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="flex-1">{opt}</span>
                    {isCorrect && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#2f855a]">
                        <Check className="size-4" aria-hidden="true" />
                        Correct answer
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {current.explanation && (
              <div className="mt-5 rounded-lg border border-[#bee3f8] bg-[#ebf8ff] p-4">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[#2b6cb0]">
                  Explanation
                </p>
                <p className="text-sm text-[#2d3748]">{current.explanation}</p>
              </div>
            )}

            <div className="mt-6 flex items-center justify-between border-t border-[#f3f4f6] pt-4">
              <Button
                variant="outline"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
                disabled={index === total - 1}
              >
                Next
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">This course has no quiz.</p>
        )}
      </div>
    </div>
  );
}
