'use client';

import React from 'react';
import { ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
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
  wizardStepperButtonClass,
  wizardSubtitleClass,
  wizardTitleClass,
} from './wizardFormClasses';
import { CourseWizardData } from '@/types/course';

const QUESTION_COUNT_MIN = 1;
const QUESTION_COUNT_MAX = 25;
const ATTEMPTS_MIN = 1;
const ATTEMPTS_MAX = 10;
const PASS_MARK_MIN = 0;
const PASS_MARK_MAX = 100;
const PASS_MARK_STEP = 5;
const PASS_MARK_DEFAULT = 80;

interface Step4QuizProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

/** The paired chevrons the frames put inside every numeric field on this step. */
function Stepper({
  onIncrease,
  onDecrease,
  increaseLabel,
  decreaseLabel,
}: {
  onIncrease: () => void;
  onDecrease: () => void;
  increaseLabel: string;
  decreaseLabel: string;
}) {
  return (
    <div className="ml-auto flex shrink-0 flex-col">
      <button
        type="button"
        aria-label={increaseLabel}
        onClick={onIncrease}
        className={wizardStepperButtonClass}
      >
        <ChevronUp className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={decreaseLabel}
        onClick={onDecrease}
        className={wizardStepperButtonClass}
      >
        <ChevronDown className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function Step4Quiz({ data, onChange }: Step4QuizProps) {
  const stepQuestionCount = (delta: number) => {
    const current = parseInt(data.quizQuestionCount, 10);
    const next = Number.isNaN(current) ? QUESTION_COUNT_MIN : current + delta;
    onChange('quizQuestionCount', String(clamp(next, QUESTION_COUNT_MIN, QUESTION_COUNT_MAX)));
  };

  const stepAttempts = (delta: number) => {
    const current = parseInt(data.quizAttempts, 10);
    const next = Number.isNaN(current) ? ATTEMPTS_MIN : current + delta;
    onChange('quizAttempts', String(clamp(next, ATTEMPTS_MIN, ATTEMPTS_MAX)));
  };

  // Steps in fives: a pass mark is a policy threshold people set to 70/75/80,
  // not a figure they nudge one point at a time like a question count.
  const stepPassMark = (delta: number) => {
    const current = parseInt(data.quizPassMark?.replace('%', '') ?? '', 10);
    // From empty, either chevron seeds the conventional pass mark rather than
    // stepping from a bound — 80 is the placeholder beside it and the figure the
    // design shows, so the first click lands somewhere a person meant to go.
    const next = Number.isNaN(current) ? PASS_MARK_DEFAULT : current + delta * PASS_MARK_STEP;
    onChange('quizPassMark', String(clamp(next, PASS_MARK_MIN, PASS_MARK_MAX)));
  };

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
            <div className={`${wizardControlClass} flex items-center gap-2`}>
              <input
                id="quiz-question-count"
                type="number"
                min={QUESTION_COUNT_MIN}
                max={QUESTION_COUNT_MAX}
                className="min-w-0 flex-1 bg-transparent outline-none [appearance:textfield] placeholder:text-muted-foreground [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={data.quizQuestionCount || ''}
                onChange={(e) => onChange('quizQuestionCount', e.target.value)}
                placeholder="1 - 25"
              />
              <Stepper
                onIncrease={() => stepQuestionCount(1)}
                onDecrease={() => stepQuestionCount(-1)}
                increaseLabel="Increase number of questions"
                decreaseLabel="Decrease number of questions"
              />
            </div>

            {/* Not in the frames, but the generator's quality drops as the count
                climbs and the admin is the one choosing it. */}
            <Alert variant="warning" title="Quality Notice">
              Adding more questions may reduce question quality. We recommend keeping questions
              concise.
            </Alert>
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

        {/* Derived from the question count, so the control mirrors rather than edits. */}
        <div className={wizardRowClass}>
          <span className={wizardLabelClass}>Estimated Duration</span>
          <div
            className={`${wizardReadonlyControlClass} flex items-center gap-2 ${
              data.quizQuestionCount ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {data.quizQuestionCount ? (
              <>
                <Clock className="size-5 text-primary" strokeWidth={2} aria-hidden="true" />~
                {Math.max(5, Math.round(parseInt(data.quizQuestionCount) * 1.5))} mins
                <span className="ml-1 text-sm text-text-secondary">
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
          <div className={`${wizardControlClass} flex items-center gap-2`}>
            <input
              id="quiz-pass-mark"
              type="number"
              min={PASS_MARK_MIN}
              max={PASS_MARK_MAX}
              className="min-w-0 flex-1 bg-transparent outline-none [appearance:textfield] placeholder:text-muted-foreground [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              value={data.quizPassMark?.replace('%', '') || ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || (Number(val) >= PASS_MARK_MIN && Number(val) <= PASS_MARK_MAX)) {
                  onChange('quizPassMark', val);
                }
              }}
              placeholder="80"
            />
            <span className="pointer-events-none shrink-0 font-medium text-text-secondary">%</span>
            <Stepper
              onIncrease={() => stepPassMark(1)}
              onDecrease={() => stepPassMark(-1)}
              increaseLabel="Increase pass mark"
              decreaseLabel="Decrease pass mark"
            />
          </div>
        </div>

        <div className={wizardRowClass}>
          <label className={wizardLabelClass} htmlFor="quiz-attempts">
            Attempts
          </label>
          <div className={`${wizardControlClass} flex items-center gap-2`}>
            <input
              id="quiz-attempts"
              type="number"
              min={ATTEMPTS_MIN}
              max={ATTEMPTS_MAX}
              className="min-w-0 flex-1 bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              value={data.quizAttempts !== 'unlimited' ? data.quizAttempts : ''}
              onChange={(e) => onChange('quizAttempts', e.target.value)}
            />
            <Stepper
              onIncrease={() => stepAttempts(1)}
              onDecrease={() => stepAttempts(-1)}
              increaseLabel="Increase attempts"
              decreaseLabel="Decrease attempts"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
