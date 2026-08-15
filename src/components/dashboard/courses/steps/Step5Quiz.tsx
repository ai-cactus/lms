'use client';

import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  wizardControlClass,
  wizardInputClass,
  wizardLabelClass,
  wizardReadonlyControlClass,
  wizardRowClass,
  wizardSubtitleClass,
  wizardTitleClass,
} from './wizardFormClasses';
import { CourseWizardData } from '@/types/course';

interface Step5QuizProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

export default function Step5Quiz({ data, onChange }: Step5QuizProps) {
  return (
    <div className="flex w-full flex-col gap-10 md:gap-14">
      <div className="flex flex-col items-center gap-3">
        <h2 className={wizardTitleClass}>Course Quiz</h2>
        <p className={wizardSubtitleClass}>
          Start by uploading the policy or compliance document you want to turn into a course. This
          will help you analyze and generate lessons and quizzes automatically.
        </p>
      </div>

      <div className="flex w-full flex-col gap-6">
        <div className={wizardRowClass}>
          <label className={wizardLabelClass} htmlFor="quiz-title">
            Quiz Title
          </label>
          <input
            id="quiz-title"
            className={wizardInputClass}
            value={data.quizTitle}
            onChange={(e) => onChange('quizTitle', e.target.value)}
            placeholder="Enter quiz title"
          />
        </div>

        <div className={`${wizardRowClass} md:items-start`}>
          <label className={`${wizardLabelClass} md:pt-4`} htmlFor="quiz-question-count">
            Number of Questions
          </label>
          <div className="flex w-full flex-col gap-4">
            <input
              id="quiz-question-count"
              type="number"
              min="1"
              max="25"
              className={wizardInputClass}
              value={data.quizQuestionCount || ''}
              onChange={(e) => onChange('quizQuestionCount', e.target.value)}
              placeholder="1 - 25"
            />
            <div className="flex flex-col overflow-hidden rounded-[12px] border border-[#fcd34d]">
              <div className="bg-[#fcd34d] px-3.5 py-[0.4rem] text-xs font-semibold tracking-[0.04em] text-black uppercase">
                Quality Notice
              </div>
              <div className="flex items-start gap-2.5 bg-[#fef2f2] px-3.5 py-3 text-[0.8125rem] leading-[1.5] text-black">
                <AlertTriangle className="mt-[0.1rem] size-4 shrink-0 text-[#dc2626]" />
                <p className="m-0">
                  <strong className="font-semibold text-[#dc2626]">WARNING:</strong> Adding more
                  questions may reduce question quality. We recommend keeping questions concise.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className={wizardRowClass}>
          <span className={wizardLabelClass} id="quiz-difficulty-label">
            Difficulty
          </span>
          <Select
            value={data.quizDifficulty}
            onValueChange={(val) => onChange('quizDifficulty', val)}
          >
            <SelectTrigger className={wizardControlClass} aria-labelledby="quiz-difficulty-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">Easy</SelectItem>
              {/* Display-only rename — the generator's stored value stays `medium`. */}
              <SelectItem value="medium">Moderate</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className={wizardRowClass}>
          <span className={wizardLabelClass} id="quiz-question-type-label">
            Question Type
          </span>
          <Select
            value={data.quizQuestionType}
            onValueChange={(val) => onChange('quizQuestionType', val)}
          >
            <SelectTrigger
              className={wizardControlClass}
              aria-labelledby="quiz-question-type-label"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
              <SelectItem value="true_false">True / False</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Estimated Duration (calculated from question count, read-only) */}
        <div className={wizardRowClass}>
          <span className={wizardLabelClass}>Estimated Duration</span>
          <div
            className={`${wizardReadonlyControlClass} flex items-center gap-2 ${
              data.quizQuestionCount ? 'text-[#0a0a0a]' : 'text-[#979797]'
            }`}
          >
            {data.quizQuestionCount ? (
              <>
                <Clock className="size-5 text-primary" strokeWidth={2} />~
                {Math.max(5, Math.round(parseInt(data.quizQuestionCount) * 1.5))} mins
                <span className="ml-1 text-sm text-[#666d80]">
                  (based on {data.quizQuestionCount} questions)
                </span>
              </>
            ) : (
              'Set question count to see estimate'
            )}
          </div>
        </div>

        <div className={wizardRowClass}>
          <label className={wizardLabelClass} htmlFor="quiz-pass-mark">
            Pass Mark
          </label>
          <div className="relative flex w-full items-center">
            <input
              id="quiz-pass-mark"
              type="number"
              min="0"
              max="100"
              className={`${wizardInputClass} pr-10`}
              value={data.quizPassMark?.replace('%', '') || ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || (Number(val) >= 0 && Number(val) <= 100)) {
                  onChange('quizPassMark', val);
                }
              }}
              placeholder="80"
            />
            <span className="pointer-events-none absolute right-[18px] font-semibold text-[#666d80]">
              %
            </span>
          </div>
        </div>

        <div className={wizardRowClass}>
          <label className={wizardLabelClass} htmlFor="quiz-attempts">
            Attempts
          </label>
          <div className={`${wizardControlClass} flex items-center gap-3`}>
            <input
              id="quiz-attempts"
              type="number"
              min="1"
              max="10"
              className="w-[64px] rounded-[8px] border border-[#e5e7ea] bg-white px-2 py-1.5 text-center text-base font-semibold text-[#0a0a0a] outline-none focus:border-primary"
              value={data.quizAttempts !== 'unlimited' ? data.quizAttempts : ''}
              onChange={(e) => onChange('quizAttempts', e.target.value)}
            />
            <span className="text-base font-medium text-[#666d80]">allowable attempts</span>
          </div>
        </div>
      </div>
    </div>
  );
}
