'use client';

import { ChevronDown, ChevronUp, CirclePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// The chevron chrome every numeric field in the wizard already shares — reused
// rather than restated so this control renders identically in its first host.
import { wizardStepperButtonClass } from '@/components/dashboard/courses/steps/wizardFormClasses';
import { MAX_WIZARD_REMINDER_ROWS } from '@/lib/enrollment/reminder-ladder';
import { cn } from '@/lib/utils';

/**
 * One "remind N days before the deadline" row. Days is the only unit the ladder
 * speaks — the server maps each row onto a whole-day stage offset — so the unit
 * is part of the row rather than a separate control's state.
 */
export interface ReminderLadderRow {
  value: number;
  unit: 'days';
}

interface ReminderLadderInputProps {
  /** The ladder, furthest-out row first. The host owns the list. */
  value: ReminderLadderRow[];
  onChange: (next: ReminderLadderRow[]) => void;
  disabled?: boolean;
  /** Extra classes for the row stack, so a host can align it to its own layout. */
  className?: string;
}

/**
 * The reminder cadence control shared by every assign surface: up to
 * {@link MAX_WIZARD_REMINDER_ROWS} whole-day offsets before the deadline.
 *
 * The cap is the server's, not a layout choice — each row maps onto one
 * worker-audience ladder stage, and a row past the last stage would be silently
 * dropped on save.
 */
export default function ReminderLadderInput({
  value,
  onChange,
  disabled = false,
  className,
}: ReminderLadderInputProps) {
  const updateReminder = (index: number, next: number) => {
    onChange(value.map((reminder, i) => (i === index ? { ...reminder, value: next } : reminder)));
  };

  const updateReminderUnit = (index: number, unit: ReminderLadderRow['unit']) => {
    onChange(value.map((reminder, i) => (i === index ? { ...reminder, unit } : reminder)));
  };

  const removeReminder = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addReminder = () => {
    if (value.length >= MAX_WIZARD_REMINDER_ROWS) return;
    onChange([...value, { value: 1, unit: 'days' }]);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {value.map((reminder, index) => (
        <div key={index} className="flex w-full items-center gap-3 md:w-auto">
          <div className="flex h-12 w-24 items-center gap-2 rounded-[10px] border border-border bg-background px-3 transition-colors focus-within:border-primary md:w-[200px] md:px-3.5">
            <input
              type="number"
              min={0}
              aria-label={`Reminder ${index + 1} days before deadline`}
              value={reminder.value}
              disabled={disabled}
              onChange={(e) => updateReminder(index, Number(e.target.value))}
              className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                aria-label={`Increase reminder ${index + 1}`}
                disabled={disabled}
                onClick={() => updateReminder(index, reminder.value + 1)}
                className={wizardStepperButtonClass}
              >
                <ChevronUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Decrease reminder ${index + 1}`}
                disabled={disabled}
                onClick={() => updateReminder(index, Math.max(0, reminder.value - 1))}
                className={wizardStepperButtonClass}
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <Select
            value={reminder.unit}
            disabled={disabled}
            onValueChange={(unit) => updateReminderUnit(index, unit as ReminderLadderRow['unit'])}
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
            disabled={disabled}
            onClick={() => removeReminder(index)}
          >
            <X className="size-5" strokeWidth={2} />
          </Button>
        </div>
      ))}

      <button
        type="button"
        onClick={addReminder}
        disabled={disabled || value.length >= MAX_WIZARD_REMINDER_ROWS}
        className="flex items-center gap-1.5 self-start text-sm font-semibold text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:text-text-tertiary disabled:no-underline"
      >
        <CirclePlus className="size-4" aria-hidden="true" />
        Add reminder
      </button>
    </div>
  );
}
