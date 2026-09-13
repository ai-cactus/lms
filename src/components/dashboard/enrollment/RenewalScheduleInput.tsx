'use client';

import React from 'react';
import { CalendarDays } from 'lucide-react';
import type { RenewalCycle } from '@/generated/prisma/enums';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * The recurring intervals every assign surface offers, defined once.
 *
 * `'none'` is deliberately absent: "this course does not recur" is the toggle's
 * job, not a row in the list. Offering it in both places would let the two
 * controls disagree — toggle on, interval "No renewal" — with no way to tell
 * which the admin meant.
 */
export const RENEWAL_CYCLE_OPTIONS: { value: Exclude<RenewalCycle, 'none'>; label: string }[] = [
  { value: 'monthly', label: 'Monthly (1 month)' },
  { value: 'quarterly', label: 'Quarterly (3 months)' },
  { value: 'semiannual', label: 'Semi-annual (6 months)' },
  { value: 'annual', label: 'Annual (12 months)' },
];

interface RenewalScheduleInputProps {
  /** Heading and blurb rendered beside the toggle; each host owns its own copy. */
  header: React.ReactNode;
  /** Accessible name for the toggle — the host's heading is not associated with it. */
  toggleLabel: string;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  /** The host may still hold `'none'`; the interval list never offers it. */
  cycle: RenewalCycle;
  onCycleChange: (next: RenewalCycle) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * The recurring-requirement control shared by every assign surface: an on/off
 * toggle plus, once on, the renewal interval.
 *
 * The host keeps both halves of the value and decides what an "off" toggle
 * persists — every caller today writes `'none'`, which is what the column has
 * always stored for a course that does not recur.
 */
export default function RenewalScheduleInput({
  header,
  toggleLabel,
  enabled,
  onEnabledChange,
  cycle,
  onCycleChange,
  disabled = false,
  className,
}: RenewalScheduleInputProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-start justify-between gap-4">
        {header}
        <Switch
          aria-label={toggleLabel}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={disabled}
        />
      </div>

      {enabled && (
        <div className="flex md:justify-end">
          <Select
            value={cycle === 'none' ? undefined : cycle}
            disabled={disabled}
            // Radix's hidden native select echoes an empty value back when the
            // control is (re)mounted inside a form; taking it would wipe a
            // perfectly good interval.
            onValueChange={(next) => {
              if (next) onCycleChange(next as RenewalCycle);
            }}
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
              {RENEWAL_CYCLE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
