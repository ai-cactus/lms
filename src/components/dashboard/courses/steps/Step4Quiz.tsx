'use client';

import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CourseWizardData } from '@/types/course';

interface Step4QuizProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

export default function Step4Quiz({ data, onChange }: Step4QuizProps) {
  return (
    <div className="relative z-50 flex w-full max-w-[800px] flex-col items-center transition-[max-width] duration-300">
      <h2 className="mb-5 shrink-0 text-center text-[32px] font-bold tracking-[-0.5px] text-[#1a202c]">
        Course Quiz
      </h2>
      <p className="mb-[30px] max-w-[600px] shrink-0 text-center text-base leading-[1.5] text-[#4a5568]">
        Start by uploading the policy or compliance document you want to turn into a course. This
        will help you analyze and generate lessons and quizzes automatically.
      </p>

      <div className="w-full flex-1 overflow-y-auto pb-10">
        <h3 className="mb-5 text-[18px] font-bold text-[#1A202C]">Course Quiz</h3>

        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-center gap-5">
          <label className="text-sm font-medium text-[#718096]">Quiz Title</label>
          <Input
            value={data.quizTitle}
            onChange={(e) => onChange('quizTitle', e.target.value)}
            placeholder="Enter quiz title"
          />
        </div>

        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-start gap-5">
          <label className="mt-2 text-sm font-medium text-[#718096]">Number of Questions</label>
          <div className="flex flex-1 flex-col gap-2">
            <div className="w-[150px]">
              <Input
                type="number"
                min="1"
                max="25"
                value={data.quizQuestionCount || ''}
                onChange={(e) => onChange('quizQuestionCount', e.target.value)}
                placeholder="1 - 25"
              />
            </div>
            <div className="mt-2 flex flex-col overflow-hidden rounded-xl border border-[#fcd34d]">
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

        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-center gap-5">
          <label className="text-sm font-medium text-[#718096]">Difficulty:</label>
          <Select
            value={data.quizDifficulty}
            onValueChange={(val) => onChange('quizDifficulty', val)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Estimated Duration (calculated from question count, read-only) */}
        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-center gap-5">
          <label className="text-sm font-medium text-[#718096]">Estimated Duration</label>
          <div
            className={`flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F7FAFC] px-3.5 py-2.5 text-sm ${
              data.quizQuestionCount ? 'text-[#2D3748]' : 'text-[#A0AEC0]'
            }`}
          >
            {data.quizQuestionCount ? (
              <>
                <Clock className="size-4 text-[#4C6EF5]" strokeWidth={2} />~
                {Math.max(5, Math.round(parseInt(data.quizQuestionCount) * 1.5))} mins
                <span className="ml-1 text-xs text-[#718096]">
                  (based on {data.quizQuestionCount} questions)
                </span>
              </>
            ) : (
              'Set question count to see estimate'
            )}
          </div>
        </div>

        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-center gap-5">
          <label className="text-sm font-medium text-[#718096]">Pass Mark:</label>
          <div className="relative flex w-full items-center">
            <input
              type="number"
              min="0"
              max="100"
              className="w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 pr-10 text-sm font-medium text-[#2d3748] outline-none transition-all focus:border-[#4c6ef5] focus:bg-white focus:shadow-[0_0_0_3px_rgba(76,110,245,0.1)]"
              value={data.quizPassMark?.replace('%', '') || ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || (Number(val) >= 0 && Number(val) <= 100)) {
                  onChange('quizPassMark', val);
                }
              }}
              placeholder="80"
            />
            <span className="pointer-events-none absolute right-4 bg-[rgba(248,250,252,0.8)] font-semibold text-[#718096]">
              %
            </span>
          </div>
        </div>

        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-center gap-5">
          <label className="text-sm font-medium text-[#718096]">Attempts:</label>
          <div>
            <div className="flex w-fit items-center gap-3 rounded-lg border border-[#edf2f7] bg-[#f7fafc] px-3 py-2">
              <input
                type="number"
                min="1"
                max="10"
                className="w-[60px] rounded-md border border-[#e2e8f0] bg-white px-2 py-1.5 text-center text-sm font-semibold text-[#2d3748] outline-none focus:border-[#4c6ef5] focus:shadow-[0_0_0_2px_rgba(76,110,245,0.1)]"
                value={data.quizAttempts !== 'unlimited' ? data.quizAttempts : ''}
                onChange={(e) => onChange('quizAttempts', e.target.value)}
              />
              <span className="text-sm font-medium text-[#64748b]">allowable attempts</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
