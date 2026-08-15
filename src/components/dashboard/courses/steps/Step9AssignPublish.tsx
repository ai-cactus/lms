'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, CirclePlus, Mail, User, X } from 'lucide-react';
import DatePicker from '@/components/ui/DatePicker';
import TimePicker from '@/components/ui/TimePicker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getRoleDisplayName, groupRolesForSelect } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';
import { wizardSubtitleClass, wizardTitleClass } from './wizardFormClasses';

import { CourseWizardData, CourseWizardReminder } from '@/types/course';
import { searchStaffUsers } from '@/app/actions/user';
import { logger } from '@/lib/logger';

interface Step9AssignPublishProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

interface Worker {
  id: string;
  name: string;
  email: string;
  initials: string;
}

type AssignMode = CourseWizardData['assignMode'];

/**
 * The assignable role catalog, grouped exactly as the design's dropdown is
 * ("MANAGERS" / "WORKERS / LEARNERS"). Derived from the RBAC registry via an
 * Owner's grant matrix, which is every role an organisation can hold except
 * `owner` itself (one seat, established at org creation — never a course target).
 */
const ROLE_GROUPS = groupRolesForSelect('owner');
const MANAGER_ROLES: Role[] =
  ROLE_GROUPS.find((g) => g.label === 'Managers')?.roles.map((r) => r.value) ?? [];
const WORKER_ROLES: Role[] =
  ROLE_GROUPS.find((g) => g.label === 'Workers / Learners')?.roles.map((r) => r.value) ?? [];
const ASSIGNABLE_ROLES: Role[] = [...MANAGER_ROLES, ...WORKER_ROLES];

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

const sectionHeadingClass = 'text-base font-semibold text-[#0d0d12] md:text-[17px]';
const sectionSubClass = 'text-sm text-[#666d80] md:text-[15px]';

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
        checked ? 'bg-primary' : 'bg-[#d2d5db]'
      }`}
    >
      <span
        className={`inline-block size-6 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[23px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function Step9AssignPublish({ data, onChange }: Step9AssignPublishProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<Worker[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [knownEmails, setKnownEmails] = useState<Set<string>>(new Set()); // Track existing org members
  const [validationError, setValidationError] = useState('');
  const [rolesOpen, setRolesOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rolesRef = useRef<HTMLDivElement>(null);

  const assignMode = data.assignMode;
  const selectedRoles = data.assignRoles as Role[];

  // Step 3's audience seeds this screen once: "Specific Roles" carries its
  // selection over, "General" starts empty. The admin can always edit it here —
  // the seed only ever fills an untouched selection.
  const seededFromAudience = useRef(false);
  useEffect(() => {
    if (seededFromAudience.current) return;
    seededFromAudience.current = true;
    if (data.audience !== 'specific') return;
    if (data.assignRoles.length > 0) return;
    const seed = ASSIGNABLE_ROLES.filter((role) => data.audienceRoles.includes(role));
    if (seed.length > 0) {
      onChange('assignRoles', seed);
    }
    // Mount-only seeding: re-running on every keystroke would fight the admin's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (inputValue.length >= 2) {
        setIsLoading(true);
        try {
          const results = await searchStaffUsers(inputValue);
          setKnownEmails((prev) => {
            const updated = new Set(prev);
            results.forEach((w: Worker) => updated.add(w.email));
            return updated;
          });
          // Filter out already assigned
          const available = results.filter((w: Worker) => !data.assignments?.includes(w.email));
          setSuggestions(available);
        } catch (err) {
          logger.error({ msg: 'Failed to search staff', err: err });
        } finally {
          setIsLoading(false);
        }
      } else {
        setSuggestions([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inputValue, data.assignments]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
      if (rolesRef.current && !rolesRef.current.contains(event.target as Node)) {
        setRolesOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const val = inputValue.trim();
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (isValidEmail) {
        addAssignment(val);
        setValidationError('');
      } else if (val) {
        setValidationError('Please enter a valid email address');
      }
      return;
    }

    if (['Enter', 'Tab', ','].includes(e.key)) {
      e.preventDefault();
      if (val) {
        if (isValidEmail) {
          addAssignment(val);
          setValidationError('');
        } else {
          setValidationError('Please enter a valid email address');
        }
      }
    } else if (e.key === 'Backspace' && !inputValue && data.assignments?.length > 0) {
      const newAssignments = [...(data.assignments || [])];
      newAssignments.pop();
      onChange('assignments', newAssignments);
      setValidationError('');
    }
  };

  const addAssignment = (value: string) => {
    if (!value) return;
    const current = data.assignments || [];
    if (!current.includes(value)) {
      onChange('assignments', [...current, value]);
    }
    setInputValue('');
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const removeAssignment = (index: number) => {
    const current = data.assignments || [];
    const newAssignments = current.filter((_: string, i: number) => i !== index);
    onChange('assignments', newAssignments);
  };

  // Rebuilt from the catalog so the stored order stays stable however the boxes
  // are ticked.
  const setRoles = (next: Role[]) => {
    onChange(
      'assignRoles',
      ASSIGNABLE_ROLES.filter((role) => next.includes(role)),
    );
  };

  const toggleRole = (role: Role, checked: boolean) => {
    setRoles(checked ? [...selectedRoles, role] : selectedRoles.filter((r) => r !== role));
  };

  const toggleGroup = (group: Role[], checked: boolean) => {
    setRoles(
      checked
        ? [...selectedRoles, ...group]
        : selectedRoles.filter((role) => !group.includes(role)),
    );
  };

  const isGroupSelected = (group: Role[]) =>
    group.length > 0 && group.every((role) => selectedRoles.includes(role));

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
    setValidationError('');
    setRolesOpen(false);
    setShowSuggestions(false);
  };

  const tabClass = (active: boolean) =>
    `flex h-[48px] flex-1 items-center justify-center gap-2 rounded-[12px] border-[1.5px] text-sm font-semibold transition-colors md:h-[52px] md:text-base ${
      active
        ? 'border-primary bg-primary/5 text-primary'
        : 'border-[#e5e7ea] bg-white text-[#454353] hover:border-[#d2d5db]'
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
          <span className="text-base font-medium tracking-[0.36px] text-black md:text-[18px]">
            Assign to
          </span>

          <div className="flex w-full gap-2">
            <button
              type="button"
              onClick={() => setMode('roles')}
              className={tabClass(assignMode === 'roles')}
            >
              <User className="size-[18px]" aria-hidden="true" />
              Select by Roles
            </button>
            <button
              type="button"
              onClick={() => setMode('email')}
              className={tabClass(assignMode === 'email')}
            >
              <Mail className="size-[18px]" aria-hidden="true" />
              Individual Email Invite
            </button>
          </div>

          {assignMode === 'roles' ? (
            <div className="relative" ref={rolesRef}>
              <div
                className={`flex min-h-[52px] w-full flex-wrap items-center gap-1.5 rounded-[12px] border-[1.5px] bg-background px-[18px] py-2.5 transition-colors md:min-h-[56px] ${
                  rolesOpen ? 'border-primary' : 'border-[#e5e7ea]'
                }`}
              >
                {selectedRoles.map((role) => (
                  <span
                    key={role}
                    className="flex items-center gap-1.5 rounded-2xl bg-primary/10 px-2.5 py-1 text-[13px] font-medium text-primary"
                  >
                    {getRoleDisplayName(role)}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${getRoleDisplayName(role)}`}
                      className="flex h-auto items-center justify-center border-none bg-transparent p-0 text-primary hover:text-error"
                      onClick={() => toggleRole(role, false)}
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} />
                    </Button>
                  </span>
                ))}

                <button
                  type="button"
                  aria-label="Choose roles"
                  aria-expanded={rolesOpen}
                  onClick={() => setRolesOpen((open) => !open)}
                  className="flex min-w-[140px] flex-1 items-center justify-between gap-2 text-left text-base text-[#979797] md:text-[18px]"
                >
                  {selectedRoles.length === 0
                    ? "Choose for specific roles (e.g. 'Nurse', 'HR')..."
                    : 'Add another role...'}
                  <ChevronDown className="size-5 shrink-0 text-[#666d80]" aria-hidden="true" />
                </button>
              </div>

              {rolesOpen && (
                <div
                  role="group"
                  aria-label="Assignable roles"
                  className="absolute left-0 top-full z-50 mt-1 max-h-[420px] w-full overflow-y-auto rounded-[12px] border border-border bg-background py-2 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]"
                >
                  <p className="px-4 py-1.5 text-xs font-semibold tracking-[0.6px] text-[#98a2b3]">
                    EVERYONE
                  </p>
                  <RoleOption
                    id="assign-group-workers"
                    label="Workers / Learners"
                    checked={isGroupSelected(WORKER_ROLES)}
                    onCheckedChange={(checked) => toggleGroup(WORKER_ROLES, checked)}
                  />
                  <RoleOption
                    id="assign-group-managers"
                    label="Managers"
                    checked={isGroupSelected(MANAGER_ROLES)}
                    onCheckedChange={(checked) => toggleGroup(MANAGER_ROLES, checked)}
                  />

                  <p className="px-4 py-1.5 text-xs font-semibold tracking-[0.6px] text-[#98a2b3]">
                    MANAGERS
                  </p>
                  {MANAGER_ROLES.map((role) => (
                    <RoleOption
                      key={role}
                      id={`assign-role-${role}`}
                      label={getRoleDisplayName(role)}
                      checked={selectedRoles.includes(role)}
                      onCheckedChange={(checked) => toggleRole(role, checked)}
                    />
                  ))}

                  <p className="px-4 py-1.5 text-xs font-semibold tracking-[0.6px] text-[#98a2b3]">
                    WORKERS / LEARNERS
                  </p>
                  {WORKER_ROLES.map((role) => (
                    <RoleOption
                      key={role}
                      id={`assign-role-${role}`}
                      label={getRoleDisplayName(role)}
                      checked={selectedRoles.includes(role)}
                      onCheckedChange={(checked) => toggleRole(role, checked)}
                    />
                  ))}
                </div>
              )}

              <p className="mt-2.5 text-sm font-medium text-[#666d80]">
                Choose one or more roles to assign this course.
              </p>
            </div>
          ) : (
            <div>
              <div
                className="relative flex min-h-[52px] w-full cursor-text flex-wrap items-center gap-1.5 rounded-[12px] border-[1.5px] border-[#e5e7ea] bg-background px-[18px] py-2.5 transition-colors focus-within:border-primary md:min-h-[56px]"
                ref={wrapperRef}
                onClick={() => document.getElementById('assign-input')?.focus()}
              >
                {(data.assignments || []).map((item: string, index: number) => {
                  const isNewInvite = !knownEmails.has(item);
                  return (
                    <div
                      key={index}
                      className={`flex items-center rounded-2xl px-2.5 py-1 text-[13px] font-medium ${
                        isNewInvite
                          ? 'border-[#764ba2] bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white'
                          : 'bg-[#edf2f7] text-foreground'
                      }`}
                    >
                      {item}
                      {isNewInvite && (
                        <span className="ml-1.5 rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-white">
                          New
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${item}`}
                        className="ml-1.5 flex h-auto items-center justify-center border-none bg-transparent p-0 text-[14px] leading-none text-text-secondary hover:text-error"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAssignment(index);
                        }}
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                      </Button>
                    </div>
                  );
                })}
                <input
                  id="assign-input"
                  aria-label="Add people, emails or names"
                  className="min-w-[120px] flex-1 border-none py-1 text-base text-[#0a0a0a] outline-none placeholder:text-[#979797] md:text-[18px]"
                  placeholder={data.assignments?.length === 0 ? 'Add people, emails or names' : ''}
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setShowSuggestions(true)}
                />

                {showSuggestions && (inputValue.length >= 2 || suggestions.length > 0) && (
                  <div className="absolute left-0 top-full z-[50] mt-1 max-h-[200px] w-full overflow-y-auto rounded-lg border border-border bg-background shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]">
                    {isLoading ? (
                      <div className="p-2.5 text-sm text-text-secondary">Searching...</div>
                    ) : suggestions.length > 0 ? (
                      suggestions.map((worker) => (
                        <div
                          key={worker.id}
                          className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[#f7fafc]"
                          onClick={() => addAssignment(worker.email)}
                        >
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#cbd5e0] text-[10px] font-bold text-white">
                            {worker.initials}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-foreground">
                              {worker.name}
                            </span>
                            <span className="text-xs text-text-secondary">{worker.email}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      inputValue.length >= 2 && (
                        <div className="p-2.5 text-sm text-text-secondary">No staff found</div>
                      )
                    )}
                  </div>
                )}
              </div>
              <p className="mt-2.5 text-sm font-medium text-[#666d80]">
                Type an email and press Enter. New emails will receive an invite with login
                credentials.
              </p>
              {validationError && <p className="mt-1.5 text-sm text-error">{validationError}</p>}
            </div>
          )}
        </div>

        <hr className="w-full border-0 border-t border-t-[#e5e7ea]" />

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
                <input
                  type="number"
                  min={0}
                  aria-label={`Reminder ${index + 1} days before deadline`}
                  value={reminder.value}
                  onChange={(e) => updateReminder(index, Number(e.target.value))}
                  className="h-11 w-[110px] rounded-[10px] border-[1.5px] border-[#e5e7ea] bg-white px-3.5 text-base text-[#0a0a0a] outline-none transition-colors focus:border-primary md:w-[140px]"
                />
                <Select
                  value={reminder.unit}
                  onValueChange={(value) => updateReminderUnit(index, value as 'days')}
                >
                  <SelectTrigger
                    aria-label={`Reminder ${index + 1} unit`}
                    className="h-11 w-[110px] rounded-[10px] border-[1.5px] border-[#e5e7ea] bg-white px-3.5 text-base text-[#0a0a0a] md:w-[140px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="days">days</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-[#666d80] md:text-base">before</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove reminder ${index + 1}`}
                  className="text-[#666d80] hover:text-error"
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
              className="flex items-center gap-1.5 self-start text-sm font-semibold text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:text-[#98a2b3] disabled:no-underline md:self-auto"
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
                  className="h-[52px] w-full rounded-[12px] border-[1.5px] border-[#e5e7ea] bg-white px-[18px] text-base text-[#0a0a0a] data-[placeholder]:text-[#979797] md:w-[330px]"
                >
                  <span className="flex items-center gap-2">
                    <CalendarDays className="size-[18px] text-[#666d80]" aria-hidden="true" />
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

function RoleOption({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 px-4 py-2 text-base text-[#0d0d12] transition-colors hover:bg-[#f7fafc]"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="size-5 shrink-0"
      />
      {label}
    </label>
  );
}
