'use client';

import React from 'react';
import { Clock, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
  wizardRowClass,
  wizardSubtitleClass,
  wizardTitleClass,
} from './wizardFormClasses';

import { CourseWizardData } from '@/types/course';

interface Step3DetailsProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

export default function Step3Details({ data, onChange }: Step3DetailsProps) {
  return (
    <div className="flex w-full flex-col gap-10 md:gap-14">
      <div className="flex flex-col items-center gap-3">
        <h2 className={wizardTitleClass}>Course Details</h2>
        <p className={wizardSubtitleClass}>
          Start by uploading the policy or compliance document you want to turn into a course. This
          will help you analyze and generate lessons and quizzes automatically.
        </p>
      </div>

      <div className="flex w-full flex-col gap-6">
        <div className={wizardRowClass}>
          <label className={wizardLabelClass}>Course Title</label>
          <input
            name="title"
            className={wizardInputClass}
            value={data.title}
            onChange={(e) => onChange('title', e.target.value)}
            placeholder="Enter course title"
          />
        </div>

        <div className={`${wizardRowClass} md:items-start`}>
          <label className={`${wizardLabelClass} md:pt-4`}>Short Description</label>
          <textarea
            name="description"
            className={`${wizardInputClass} min-h-[136px] resize-y py-4 leading-6`}
            value={data.description}
            onChange={(e) => onChange('description', e.target.value)}
            placeholder="Enter short description"
          />
        </div>

        {/* Estimated Duration (AI-generated, read-only) */}
        <div className={wizardRowClass}>
          <label className={wizardLabelClass}>Estimated Duration</label>
          <div
            className={`${wizardControlClass} flex items-center gap-2 bg-bg-secondary ${
              data.duration ? 'text-[#0a0a0a]' : 'text-[#979797]'
            }`}
          >
            {data.duration ? (
              <>
                <Clock className="size-5 text-primary" aria-hidden="true" />~{data.duration} mins
                <span className="ml-1 text-sm text-[#666d80]">(Estimate)</span>
              </>
            ) : (
              'Will be estimated after document analysis'
            )}
          </div>
        </div>

        <div className={wizardRowClass}>
          <label className={wizardLabelClass}>No of Notes / Slides</label>
          <Select value={data.notesCount} onValueChange={(val) => onChange('notesCount', val)}>
            <SelectTrigger className={wizardControlClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="15">15</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="25">25</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <hr className="w-full border-0 border-t border-t-[#e5e7ea]" />

      <div className="flex w-full flex-col gap-6">
        <h3 className="text-xl font-bold text-foreground md:text-[24px]">Learning Objectives</h3>

        <div className={`${wizardRowClass} md:items-start`}>
          <label className={`${wizardLabelClass} md:pt-4`}>
            Objectives
            <span className="ml-2 text-sm font-normal text-[#979797]">(Minimum 3 required)</span>
          </label>
          <div className="flex w-full flex-col gap-3">
            {data.objectives.map((obj: string, index: number) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex w-6 shrink-0 justify-center text-base font-semibold text-[#666d80]">
                  {index + 1}.
                </div>
                <input
                  className={wizardInputClass}
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
                  size="icon"
                  onClick={() => {
                    const newObjectives = data.objectives.filter(
                      (_: string, i: number) => i !== index,
                    );
                    onChange('objectives', newObjectives);
                  }}
                  className="shrink-0 text-error"
                  title="Remove Objective"
                >
                  <X className="size-5" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                onChange('objectives', [...data.objectives, '']);
              }}
              className="mt-2 h-[52px] w-full rounded-[12px] border-[1.5px] border-dashed border-[#d2d5db] text-base font-semibold text-[#454353] md:h-[56px]"
            >
              + Add Objective
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
