'use client';

import React from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ALL_ROLES, getRoleDisplayName } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';
import { CourseWizardData } from '@/types/course';
import { wizardSubtitleClass, wizardTitleClass } from './wizardFormClasses';

type Audience = CourseWizardData['audience'];

const AUDIENCE_OPTIONS: { value: Audience; title: string; description: string }[] = [
  {
    value: 'general',
    title: 'General',
    description: 'Every staff member gets this course regardless of role.',
  },
  {
    value: 'specific',
    title: 'Specific Roles',
    description: 'Only staffs with selected roles will be assigned this course.',
  },
];

/**
 * The wizard's Next gate for this step: "General" needs no further input, while
 * "Specific Roles" is meaningless until at least one role is picked.
 */
export function isAudienceSelectionValid(
  data: Pick<CourseWizardData, 'audience' | 'audienceRoles'>,
): boolean {
  return data.audience === 'general' || data.audienceRoles.length > 0;
}

interface Step3AudienceProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

export default function Step3Audience({ data, onChange }: Step3AudienceProps) {
  const selectedRoles = data.audienceRoles;
  const allRolesSelected = ALL_ROLES.every((role) => selectedRoles.includes(role));

  const toggleRole = (role: Role, checked: boolean) => {
    // Rebuilt from ALL_ROLES so the stored order stays the catalog order however
    // the boxes are ticked.
    const next = checked
      ? ALL_ROLES.filter((r) => r === role || selectedRoles.includes(r))
      : selectedRoles.filter((r) => r !== role);
    onChange('audienceRoles', next);
  };

  return (
    <div className="flex w-full flex-col gap-10 md:gap-14">
      <div className="flex flex-col items-center gap-3">
        <h2 className={wizardTitleClass}>Who is this course for?</h2>
        <p className={wizardSubtitleClass}>
          Training will be automatically assigned to staff based on your selection here.
        </p>
      </div>

      <div className="flex w-full flex-col gap-6">
        <RadioGroup
          value={data.audience}
          onValueChange={(value) => onChange('audience', value as Audience)}
          className="grid grid-cols-1 gap-5 md:grid-cols-2"
        >
          {AUDIENCE_OPTIONS.map((option) => {
            const isSelected = data.audience === option.value;
            return (
              <label
                key={option.value}
                htmlFor={`audience-${option.value}`}
                className={`flex cursor-pointer items-start justify-between gap-4 rounded-[12px] border-[1.5px] p-5 transition-colors md:p-6 ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-[#e5e7ea] bg-white hover:border-[#d2d5db]'
                }`}
              >
                <span className="flex flex-col gap-2">
                  <span className="text-lg font-bold text-[#0d0d12] md:text-xl">
                    {option.title}
                  </span>
                  <span className="text-sm leading-6 text-[#666d80] md:text-base">
                    {option.description}
                  </span>
                </span>
                <RadioGroupItem
                  id={`audience-${option.value}`}
                  value={option.value}
                  className="mt-1 size-5 shrink-0"
                />
              </label>
            );
          })}
        </RadioGroup>

        {data.audience === 'specific' && (
          <div className="flex w-full flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium tracking-[0.32px] text-[#666d80] md:text-base">
                Select roles
              </span>
              <button
                type="button"
                onClick={() => onChange('audienceRoles', allRolesSelected ? [] : [...ALL_ROLES])}
                className="text-sm font-semibold text-primary hover:underline md:text-base"
              >
                {allRolesSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ALL_ROLES.map((role) => {
                const isChecked = selectedRoles.includes(role);
                return (
                  <label
                    key={role}
                    htmlFor={`audience-role-${role}`}
                    className={`flex cursor-pointer items-center gap-3 rounded-[10px] border-[1.5px] px-4 py-3.5 text-sm font-medium transition-colors md:text-base ${
                      isChecked
                        ? 'border-primary bg-primary/5 text-[#0d0d12]'
                        : 'border-[#e5e7ea] bg-white text-[#454353] hover:border-[#d2d5db]'
                    }`}
                  >
                    <Checkbox
                      id={`audience-role-${role}`}
                      checked={isChecked}
                      onCheckedChange={(checked) => toggleRole(role, checked === true)}
                      className="size-5 shrink-0"
                    />
                    {getRoleDisplayName(role)}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
