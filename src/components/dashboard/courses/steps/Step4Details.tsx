'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getCategories } from '@/app/actions/categories';
import { logger } from '@/lib/logger';
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

// Notes & slides is the only content type the generation pipeline produces, so
// the picker is a real select with a single option rather than a stored field.
const CONTENT_TYPE_VALUE = 'notes_slides';

const DEADLINE_MIN_DAYS = 1;
const DEADLINE_MAX_DAYS = 365;

// Matches the wizard's Next gate, so removing an objective can never leave the
// step in a state the gate silently rejects.
const MIN_OBJECTIVES = 3;

interface Step4DetailsProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

export default function Step4Details({ data, onChange }: Step4DetailsProps) {
  const { categoryId } = data;
  const [categoryName, setCategoryName] = useState('');

  // The wizard carries only the category id, so the read-only display name is
  // resolved here rather than duplicated into the draft.
  useEffect(() => {
    let cancelled = false;

    async function loadCategoryName() {
      try {
        const categories = await getCategories();
        if (cancelled) return;
        setCategoryName(categories.find((category) => category.id === categoryId)?.name ?? '');
      } catch (err) {
        logger.error({ msg: '[course] Failed to load the course category name', err });
      }
    }

    loadCategoryName();
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  const stepDeadline = (delta: number) => {
    const current = data.completionDeadlineDays;
    const next = current === null ? DEADLINE_MIN_DAYS : current + delta;
    onChange(
      'completionDeadlineDays',
      Math.min(DEADLINE_MAX_DAYS, Math.max(DEADLINE_MIN_DAYS, next)),
    );
  };

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
          <label className={wizardLabelClass} htmlFor="course-title">
            Course Title
          </label>
          <input
            id="course-title"
            name="title"
            className={wizardInputClass}
            value={data.title}
            onChange={(e) => onChange('title', e.target.value)}
            placeholder="Enter course title"
          />
        </div>

        <div className={`${wizardRowClass} md:items-start`}>
          <label className={`${wizardLabelClass} md:pt-4`} htmlFor="course-description">
            Short Description
          </label>
          <textarea
            id="course-description"
            name="description"
            className={`${wizardInputClass} min-h-[136px] resize-y py-4 leading-6`}
            value={data.description}
            onChange={(e) => onChange('description', e.target.value)}
            placeholder="Enter short description"
          />
        </div>

        {/* Chosen on step 1 — shown here for confirmation only. */}
        <div className={wizardRowClass}>
          <span className={wizardLabelClass}>Category</span>
          <div
            className={`${wizardReadonlyControlClass} flex items-center ${
              categoryName ? 'text-[#0a0a0a]' : 'text-[#979797]'
            }`}
          >
            {categoryName || 'Selected on the category step'}
          </div>
        </div>

        <div className={wizardRowClass}>
          <span className={wizardLabelClass} id="content-type-label">
            Content Type
          </span>
          <Select value={CONTENT_TYPE_VALUE}>
            <SelectTrigger className={wizardControlClass} aria-labelledby="content-type-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CONTENT_TYPE_VALUE}>Notes &amp; Slides</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className={wizardRowClass}>
          <span className={wizardLabelClass} id="notes-count-label">
            No of Notes / Slides
          </span>
          <Select value={data.notesCount} onValueChange={(val) => onChange('notesCount', val)}>
            <SelectTrigger className={wizardControlClass} aria-labelledby="notes-count-label">
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

        <div className={wizardRowClass}>
          <label className={wizardLabelClass} htmlFor="completion-deadline">
            Deadline to Complete Course
          </label>
          <div className={`${wizardControlClass} flex items-center gap-1.5`}>
            <input
              id="completion-deadline"
              type="number"
              min={DEADLINE_MIN_DAYS}
              max={DEADLINE_MAX_DAYS}
              className="w-10 bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              value={data.completionDeadlineDays ?? ''}
              onChange={(e) =>
                onChange(
                  'completionDeadlineDays',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
            />
            <span className="text-[#666d80]">days</span>
            <div className="ml-auto flex flex-col text-[#666d80]">
              <button
                type="button"
                aria-label="Increase deadline"
                onClick={() => stepDeadline(1)}
                className="transition-colors hover:text-primary"
              >
                <ChevronUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Decrease deadline"
                onClick={() => stepDeadline(-1)}
                className="transition-colors hover:text-primary"
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <hr className="w-full border-0 border-t border-t-[#e5e7ea]" />

      <div className="flex w-full flex-col gap-6">
        <h3 className="text-xl font-bold text-foreground md:text-[24px]">Learning Objectives</h3>

        <div className={`${wizardRowClass} md:items-start`}>
          <span className={`${wizardLabelClass} md:pt-4`}>
            Objectives
            <span className="ml-2 text-sm font-normal text-[#979797]">(Minimum 3 required)</span>
          </span>
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
                  disabled={data.objectives.length <= MIN_OBJECTIVES}
                  onClick={() => {
                    const newObjectives = data.objectives.filter(
                      (_: string, i: number) => i !== index,
                    );
                    onChange('objectives', newObjectives);
                  }}
                  className="shrink-0 text-error disabled:opacity-30"
                  aria-label={`Remove objective ${index + 1}`}
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
