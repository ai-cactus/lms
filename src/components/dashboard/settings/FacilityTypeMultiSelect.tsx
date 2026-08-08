'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { FACILITY_TYPE_OPTIONS, OTHER_FACILITY_TYPE } from '@/lib/facility/facility-type-options';

export interface FacilityTypeValue {
  /** Canonical selections; may include the `OTHER_FACILITY_TYPE` sentinel. */
  types: string[];
  /** Free text backing the sentinel; ignored while the sentinel is unchecked. */
  otherText: string;
}

/**
 * Split a stored `Facility.type` string (canonical labels joined with ", ",
 * optionally ending in one free-text entry) back into selections. Non-canonical
 * segments are re-joined so a custom label containing ", " survives round-trips.
 */
export function parseFacilityTypes(stored: string | null | undefined): FacilityTypeValue {
  if (!stored) return { types: [], otherText: '' };
  const known = new Set<string>(FACILITY_TYPE_OPTIONS);
  const segments = stored.split(', ');
  const types = segments.filter((segment) => known.has(segment));
  const otherText = segments.filter((segment) => !known.has(segment)).join(', ');
  return otherText ? { types: [...types, OTHER_FACILITY_TYPE], otherText } : { types, otherText };
}

/** Join selections back into the single stored string, custom text last. */
export function joinFacilityTypes(value: FacilityTypeValue): string {
  const canonical = FACILITY_TYPE_OPTIONS.filter((option) => value.types.includes(option));
  const custom = value.types.includes(OTHER_FACILITY_TYPE) ? value.otherText.trim() : '';
  return [...canonical, ...(custom ? [custom] : [])].join(', ');
}

interface FacilityTypeMultiSelectProps {
  value: FacilityTypeValue;
  onChange: (value: FacilityTypeValue) => void;
  className?: string;
  placeholder?: string;
}

/**
 * Multi-select for facility types whose closed state never overflows: it shows
 * the first selection as a truncating chip and folds the rest into a "+n" count.
 */
export function FacilityTypeMultiSelect({
  value,
  onChange,
  className,
  placeholder = 'Select facility type',
}: FacilityTypeMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const isOther = value.types.includes(OTHER_FACILITY_TYPE);
  const labels = [
    ...FACILITY_TYPE_OPTIONS.filter((option) => value.types.includes(option)),
    ...(isOther ? [value.otherText.trim() || OTHER_FACILITY_TYPE] : []),
  ];

  const toggle = (option: string, checked: boolean) =>
    onChange({
      ...value,
      types: checked ? [...value.types, option] : value.types.filter((t) => t !== option),
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'flex w-full cursor-pointer items-center justify-between gap-2 bg-background text-left',
            className,
          )}
        >
          {labels.length === 0 ? (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate rounded-lg bg-background-secondary px-2.5 py-1 text-sm text-foreground">
                {labels[0]}
              </span>
              {labels.length > 1 && (
                <span className="shrink-0 rounded-lg bg-background-secondary px-2 py-1 text-sm font-medium text-text-secondary">
                  +{labels.length - 1}
                </span>
              )}
            </span>
          )}
          <ChevronDown className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto overscroll-contain [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:bg-border">
          {[...FACILITY_TYPE_OPTIONS, OTHER_FACILITY_TYPE].map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-2.5">
              <Checkbox
                className="size-[18px] rounded-[5px]"
                checked={value.types.includes(option)}
                onCheckedChange={(checked) => toggle(option, checked === true)}
              />
              <span className="min-w-0 text-sm break-words text-foreground">{option}</span>
            </label>
          ))}

          {isOther && (
            <Input
              className="h-9 rounded-none border-0 border-b border-input px-0 text-sm shadow-none focus-visible:border-primary focus-visible:ring-0"
              placeholder="Describe the facility type"
              aria-label="Other facility type"
              value={value.otherText}
              onChange={(event) => onChange({ ...value, otherText: event.target.value })}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
