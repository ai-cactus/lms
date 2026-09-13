'use client';

import React from 'react';
import { CalendarDays, ChevronDown, ChevronUp, CirclePlus, Mail, User, X } from 'lucide-react';
import DatePicker from '@/components/ui/DatePicker';
import TimePicker from '@/components/ui/TimePicker';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import RoleTargetPicker from '@/components/dashboard/enrollment/RoleTargetPicker';
import AssigneesInput from '@/components/dashboard/enrollment/AssigneesInput';
import type { UserRole } from '@/generated/prisma/enums';
import {
  wizardDividerClass,
  wizardStepperButtonClass,
  wizardSubtitleClass,
  wizardTitleClass,
} from './wizardFormClasses';

import { CourseWizardData, CourseWizardReminder } from '@/types/course';
import { searchStaffUsers } from '@/app/actions/user';

interface Step7AssignProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

type AssignMode = CourseWizardData['assignMode'];

/**
 * How many "N days before" rows the schedule can carry. The server maps each row
 * onto one worker-audience ladder stage, and there are exactly three of those —
 * see `WIZARD_REMINDER_STAGES` in `src/lib/enrollment/assignment.ts`.
 */
const MAX_REMINDER_ROWS = 3;

const RENEWAL_OPTIONS: { value: string; label: string }[] = [
  { value: 'monthly', label: 'Monthly (1 month)' },
  { value: 'quarterly', label: 'Quarterly (3 months)' },
  { value: 'semiannual', label: 'Semi-annual (6 months)' },
  { value: 'annual', label: 'Annual (12 months)' },
];

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

function ToggleSwitch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-7 w-[52px] shrink-0 cursor-pointer items-center rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-input'
      }`}
    >
      <span
        className={`inline-block size-6 transform rounded-full bg-background shadow transition-transform ${
          checked ? 'translate-x-[23px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function Step7Assign({ data, onChange }: Step7AssignProps) {
  const assignMode = data.assignMode;
  const selectedRoles = data.assignRoles as UserRole[];

  const updateReminder = (index: number, value: number) => {
    const next = data.reminders.map((reminder, i) =>
      i === index ? { ...reminder, value } : reminder,
    );
    onChange('reminders', next);
  };

  const updateReminderUnit = (index: number, unit: CourseWizardReminder['unit']) => {
    const next = data.reminders.map((reminder, i) =>
      i === index ? { ...reminder, unit } : reminder,
    );
    onChange('reminders', next);
  };

  const removeReminder = (index: number) => {
    onChange(
      'reminders',
      data.reminders.filter((_, i) => i !== index),
    );
  };

  const addReminder = () => {
    if (data.reminders.length >= MAX_REMINDER_ROWS) return;
    const next: CourseWizardReminder = { value: 1, unit: 'days' };
    onChange('reminders', [...data.reminders, next]);
  };

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
            <ToggleSwitch
              label="Set Completion Deadline"
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

          <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
            {data.reminders.map((reminder, index) => (
              <div key={index} className="flex w-full items-center gap-3 md:w-auto">
                <div className="flex h-12 w-24 items-center gap-2 rounded-[10px] border border-border bg-background px-3 transition-colors focus-within:border-primary md:w-[200px] md:px-3.5">
                  <input
                    type="number"
                    min={0}
                    aria-label={`Reminder ${index + 1} days before deadline`}
                    value={reminder.value}
                    onChange={(e) => updateReminder(index, Number(e.target.value))}
                    className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      aria-label={`Increase reminder ${index + 1}`}
                      onClick={() => updateReminder(index, reminder.value + 1)}
                      className={wizardStepperButtonClass}
                    >
                      <ChevronUp className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Decrease reminder ${index + 1}`}
                      onClick={() => updateReminder(index, Math.max(0, reminder.value - 1))}
                      className={wizardStepperButtonClass}
                    >
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <Select
                  value={reminder.unit}
                  onValueChange={(value) => updateReminderUnit(index, value as 'days')}
                >
                  <SelectTrigger
                    aria-label={`Reminder ${index + 1} unit`}
                    className="h-12 w-24 rounded-[10px] border border-border bg-background px-3 text-base text-foreground data-[size=default]:h-12 md:w-[200px] md:px-3.5"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="days">days</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-text-secondary md:text-base">before</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove reminder ${index + 1}`}
                  className="text-text-secondary hover:text-error"
                  onClick={() => removeReminder(index)}
                >
                  <X className="size-5" strokeWidth={2} />
                </Button>
              </div>
            ))}

            <button
              type="button"
              onClick={addReminder}
              disabled={data.reminders.length >= MAX_REMINDER_ROWS}
              className="flex items-center gap-1.5 self-start text-sm font-semibold text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:text-text-tertiary disabled:no-underline"
            >
              <CirclePlus className="size-4" aria-hidden="true" />
              Add reminder
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h3 className={sectionHeadingClass}>Recurring Course Requirement</h3>
              <p className={sectionSubClass}>
                Employees must complete this course based on the selected interval. Deadlines and
                reminders will be set automatically according to the chosen schedule.
              </p>
            </div>
            <ToggleSwitch
              label="Recurring Course Requirement"
              checked={data.recurringEnabled}
              onCheckedChange={(next) => {
                onChange('recurringEnabled', next);
                if (!next) onChange('renewalCycle', 'none');
              }}
            />
          </div>

          {data.recurringEnabled && (
            <div className="flex md:justify-end">
              <Select
                value={data.renewalCycle === 'none' ? undefined : data.renewalCycle}
                onValueChange={(value) => onChange('renewalCycle', value)}
              >
                <SelectTrigger
                  aria-label="Select interval"
                  className="h-[52px] w-full rounded-[10px] border border-border bg-background px-[18px] text-base text-foreground data-[size=default]:h-[52px] data-[placeholder]:text-muted-foreground md:w-[460px]"
                >
                  <span className="flex items-center gap-2">
                    <CalendarDays className="size-[18px] text-text-secondary" aria-hidden="true" />
                    <SelectValue placeholder="Select interval" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {RENEWAL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
