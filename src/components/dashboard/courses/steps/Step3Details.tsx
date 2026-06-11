'use client';

import React from 'react';
import { Clock } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/legacy/Select';

import { CourseWizardData } from '@/types/course';

interface Step3DetailsProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

export default function Step3Details({ data, onChange }: Step3DetailsProps) {
  return (
    <div className="relative z-50 flex w-full max-w-[800px] flex-col items-center transition-[max-width] duration-300">
      <h2 className="mb-5 shrink-0 text-center font-heading text-[32px] font-bold tracking-[-0.5px] text-foreground">
        Course Details
      </h2>
      <p className="mb-[30px] max-w-[600px] shrink-0 text-center text-base leading-[1.5] text-text-secondary">
        Start by uploading the policy or compliance document you want to turn into a course. This
        will help you analyze and generate lessons and quizzes automatically.
      </p>

      <div className="w-full flex-1 overflow-y-auto pb-10">
        {/* Course Title */}
        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-center gap-5">
          <label className="text-sm font-medium text-text-muted">Course Title</label>
          <Input
            name="title"
            value={data.title}
            onChange={(e) => onChange('title', e.target.value)}
            placeholder="Enter course title"
          />
        </div>

        {/* Short Description */}
        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-start gap-5">
          <label className="pt-3 text-sm font-medium text-text-muted">Short Description</label>
          <textarea
            name="description"
            className="min-h-[120px] w-full resize-y rounded-lg border border-border px-4 py-3 font-[inherit] text-base text-[#2d3748] transition-all duration-200 ease-in-out outline-none focus:border-[#2d4ddd] focus:shadow-[0_0_0_3px_rgba(45,77,221,0.1)]"
            value={data.description}
            onChange={(e) => onChange('description', e.target.value)}
            placeholder="Enter short description"
          />
        </div>

        {/* Estimated Duration (AI-generated, read-only) */}
        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-center gap-5">
          <label className="text-sm font-medium text-text-muted">Estimated Duration</label>
          <div
            className={`flex items-center gap-2 rounded-lg border border-border bg-bg-secondary px-3.5 py-2.5 text-sm ${
              data.duration ? 'text-[#2D3748]' : 'text-[#A0AEC0]'
            }`}
          >
            {data.duration ? (
              <>
                <Clock className="size-4 text-primary" aria-hidden="true" />~{data.duration} mins
                <span className="ml-1 text-xs text-text-muted">(Estimate)</span>
              </>
            ) : (
              'Will be estimated after document analysis'
            )}
          </div>
        </div>

        {/* No of Notes / Slides */}
        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-center gap-5">
          <label className="text-sm font-medium text-text-muted">No of Notes / Slides</label>
          <Select
            value={data.notesCount}
            onChange={(val) => onChange('notesCount', val)}
            options={[
              { label: '10', value: '10' },
              { label: '15', value: '15' },
              { label: '20', value: '20' },
              { label: '25', value: '25' },
            ]}
          />
        </div>

        <hr className="my-10 border-0 border-t border-t-[#EDF2F7]" />

        <h3 className="mb-6 text-xl font-bold text-foreground">Learning Objectives</h3>

        {/* Learning Objectives */}
        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-start gap-5">
          <label className="pt-3 text-sm font-medium text-text-muted">
            Objectives
            <span className="ml-2 text-xs font-normal text-text-muted">(Minimum 3 required)</span>
          </label>
          <div className="flex w-full flex-col gap-3">
            {data.objectives.map((obj: string, index: number) => (
              <div key={index} className="mb-2 flex gap-2">
                <div className="flex h-10 w-6 items-center justify-center font-semibold text-text-muted">
                  {index + 1}.
                </div>
                <Input
                  value={obj}
                  onChange={(e) => {
                    const newObjectives = [...data.objectives];
                    newObjectives[index] = e.target.value;
                    onChange('objectives', newObjectives);
                  }}
                  placeholder={`Objective ${index + 1}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newObjectives = data.objectives.filter(
                      (_: string, i: number) => i !== index,
                    );
                    onChange('objectives', newObjectives);
                  }}
                  className="text-error"
                  title="Remove Objective"
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                onChange('objectives', [...data.objectives, '']);
              }}
              className="mt-2 w-full border-dashed"
            >
              + Add Objective
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
