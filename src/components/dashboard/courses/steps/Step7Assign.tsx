'use client';

import React from 'react';
import { Mail, User } from 'lucide-react';
import DatePicker from '@/components/ui/DatePicker';
import TimePicker from '@/components/ui/TimePicker';
import { Switch } from '@/components/ui/switch';
import RoleTargetPicker from '@/components/dashboard/enrollment/RoleTargetPicker';
import AssigneesInput from '@/components/dashboard/enrollment/AssigneesInput';
import ReminderLadderInput from '@/components/dashboard/enrollment/ReminderLadderInput';
import RenewalScheduleInput from '@/components/dashboard/enrollment/RenewalScheduleInput';
import type { RenewalCycle, UserRole } from '@/generated/prisma/enums';
import { wizardDividerClass, wizardSubtitleClass, wizardTitleClass } from './wizardFormClasses';

import { CourseWizardData } from '@/types/course';
import { searchStaffUsers } from '@/app/actions/user';

interface Step7AssignProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

type AssignMode = CourseWizardData['assignMode'];

/**
 * The wizard's Publish gate for this step: a course must reach somebody. Role
 * mode needs at least one role, email mode at least one recipient.
 */
export function isAssignSelectionValid(
  data: Pick<CourseWizardData, 'assignMode' | 'assignRoles' | 'assignments'>,
): boolean {
  return data.assignMode === 'roles'
    ? data.assignRoles.length > 0
    : (data.assignments?.length ?? 0) > 0;
}

const sectionHeadingClass = 'text-base font-semibold text-foreground md:text-[17px]';
const sectionSubClass = 'text-sm text-text-secondary md:text-[15px]';

export default function Step7Assign({ data, onChange }: Step7AssignProps) {
  const assignMode = data.assignMode;
  const selectedRoles = data.assignRoles as UserRole[];

  const setMode = (mode: AssignMode) => {
    if (mode === assignMode) return;
    onChange('assignMode', mode);
  };

  const tabClass = (active: boolean) =>
    `flex h-[48px] flex-1 items-center justify-center gap-2 rounded-[10px] border-[1.5px] text-sm font-semibold transition-colors md:h-[52px] md:text-base ${
      active
        ? 'border-primary bg-primary/5 text-primary'
        : 'border-border bg-background text-text-secondary hover:border-input'
    }`;

  return (
    <div className="flex w-full flex-col gap-10 md:gap-14">
      <div className="flex flex-col items-center gap-3">
        <h2 className={wizardTitleClass}>Assigning &amp; Publish</h2>
        <p className={wizardSubtitleClass}>
          Select which staff should take this course, set deadlines, and finalize publishing.
        </p>
      </div>

      <div className="flex w-full flex-col gap-8">
        <div className="flex flex-col gap-3">
          <span className="text-base font-medium tracking-[0.36px] text-foreground md:text-[18px]">
            Assign to
          </span>

          <div className="flex w-full gap-2">
            <button
              type="button"
              onClick={() => setMode('email')}
              className={tabClass(assignMode === 'email')}
            >
              <Mail className="size-[18px]" aria-hidden="true" />
              Individual Email Invite
            </button>
            <button
              type="button"
              onClick={() => setMode('roles')}
              className={tabClass(assignMode === 'roles')}
            >
              <User className="size-[18px]" aria-hidden="true" />
              Select by Roles
            </button>
          </div>

          {assignMode === 'roles' ? (
            <RoleTargetPicker
              selectedRoles={selectedRoles}
              onSelectionChange={(roles) => onChange('assignRoles', roles)}
              mode={{ kind: 'draft' }}
            />
          ) : (
            <div>
              <AssigneesInput
                value={data.assignments || []}
                onChange={(next) => onChange('assignments', next)}
                onSearch={searchStaffUsers}
                className="min-h-[52px] px-[18px] py-2.5 md:min-h-[56px]"
              />
              <p className="mt-2.5 text-sm font-medium text-text-secondary">
                Type an email and press Enter. New emails will receive an invite with login
                credentials.
              </p>
            </div>
          )}
        </div>

        <hr className={wizardDividerClass} />

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h3 className={sectionHeadingClass}>Set Completion Deadline</h3>
              <p className={sectionSubClass}>
                Set a deadline for team member to complete this course
              </p>
            </div>
            <Switch
              aria-label="Set Completion Deadline"
              checked={data.dueDeadlineEnabled}
              onCheckedChange={(next) => onChange('dueDeadlineEnabled', next)}
            />
          </div>

          {data.dueDeadlineEnabled && (
            <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
              <DatePicker
                value={data.dueDate || ''}
                onChange={(val) => onChange('dueDate', val)}
                placeholder="Due date"
                label="Due date"
                iconPosition="start"
              />
              <TimePicker
                value={data.dueTime || ''}
                onChange={(val) => onChange('dueTime', val)}
                placeholder="Due time"
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-10">
          <div className="flex flex-col gap-1">
            <h3 className={sectionHeadingClass}>Automated reminders</h3>
            <p className={sectionSubClass}>
              Staff are reminded automatically before the deadline. Add more if you need them.
            </p>
          </div>

          <ReminderLadderInput
            value={data.reminders}
            onChange={(next) => onChange('reminders', next)}
            className="shrink-0 items-start md:items-end"
          />
        </div>

        <RenewalScheduleInput
          toggleLabel="Recurring Course Requirement"
          header={
            <div className="flex flex-col gap-1">
              <h3 className={sectionHeadingClass}>Recurring Course Requirement</h3>
              <p className={sectionSubClass}>
                Employees must complete this course based on the selected interval. Deadlines and
                reminders will be set automatically according to the chosen schedule.
              </p>
            </div>
          }
          enabled={data.recurringEnabled}
          onEnabledChange={(next) => {
            onChange('recurringEnabled', next);
            if (!next) onChange('renewalCycle', 'none');
          }}
          cycle={data.renewalCycle as RenewalCycle}
          onCycleChange={(next) => onChange('renewalCycle', next)}
        />
      </div>
    </div>
  );
}
