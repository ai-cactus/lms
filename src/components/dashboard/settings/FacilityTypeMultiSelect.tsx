'use client';

import { useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
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
 *
 * This tolerance is also what keeps a renamed option readable: a value stored
 * under an older label simply resurfaces as the "Other" free text.
 */
export function parseFacilityTypes(stored: string | null | undefined): FacilityTypeValue {
  if (!stored) return { types: [], otherText: '' };
  const known = new Set<string>(FACILITY_TYPE_OPTIONS);
  const segments = stored.split(', ');
  const types = segments.filter((segment) => known.has(segment));
  const otherText = segments.filter((segment) => !known.has(segment)).join(', ');
  return otherText ? { types: [...types, OTHER_FACILITY_TYPE], otherText } : { types, otherText };
}

/** Selections as a list, in registry order, with the custom text last. */
export function facilityTypeList(value: FacilityTypeValue): string[] {
  const canonical = FACILITY_TYPE_OPTIONS.filter((option) => value.types.includes(option));
  const custom = value.types.includes(OTHER_FACILITY_TYPE) ? value.otherText.trim() : '';
  return [...canonical, ...(custom ? [custom] : [])];
}

/** Join selections back into the single stored string, custom text last. */
export function joinFacilityTypes(value: FacilityTypeValue): string {
  return facilityTypeList(value).join(', ');
}

interface FacilityTypeChip {
  /** What the chip reads as — the custom text stands in for the sentinel. */
  label: string;
  /** The option the chip's remove control unchecks. */
  option: string;
}

/**
 * Chips for the closed state. Unlike `facilityTypeList`, a checked-but-blank
 * "Other" still yields a chip so the selection never disappears mid-edit.
 */
export function facilityTypeChips(value: FacilityTypeValue): FacilityTypeChip[] {
  const canonical = FACILITY_TYPE_OPTIONS.filter((option) => value.types.includes(option)).map(
    (option) => ({ label: option, option }),
  );
  if (!value.types.includes(OTHER_FACILITY_TYPE)) return canonical;
  return [
    ...canonical,
    { label: value.otherText.trim() || OTHER_FACILITY_TYPE, option: OTHER_FACILITY_TYPE },
  ];
}

/**
 * Chips shown before the rest collapse into a "+n more" pill. Fixed rather than
 * measured: a deterministic cut keeps the trigger one row tall at every width,
 * which a ResizeObserver-driven count cannot promise during layout.
 */
const MAX_VISIBLE_CHIPS = 2;

interface FacilityTypeMultiSelectProps {
  value: FacilityTypeValue;
  onChange: (value: FacilityTypeValue) => void;
  className?: string;
  placeholder?: string;
  id?: string;
  'aria-describedby'?: string;
}

/**
 * Dropdown multi-select for facility types. The closed state shows the
 * selections as removable chips; the panel is the canonical checkbox list plus
 * the "Other" free-text row.
 */
export function FacilityTypeMultiSelect({
  value,
  onChange,
  className,
  placeholder = 'Select an option',
  id,
  'aria-describedby': ariaDescribedBy,
}: FacilityTypeMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  const isOther = value.types.includes(OTHER_FACILITY_TYPE);
  const chips = facilityTypeChips(value);
  const visibleChips = chips.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = chips.length - visibleChips.length;

  const toggle = (option: string, checked: boolean) =>
    onChange({
      ...value,
      types: checked ? [...value.types, option] : value.types.filter((t) => t !== option),
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          ref={triggerRef}
          className={cn(
            'relative flex w-full items-center gap-2 rounded-[10px] border border-input bg-background px-4',
            className,
          )}
        >
          {/* The whole box opens the panel, but the chips' remove controls are
              real buttons — so the trigger sits behind them rather than
              wrapping them, which would nest interactive elements. */}
          <button
            type="button"
            id={id}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label="Facility type"
            aria-describedby={ariaDescribedBy}
            onClick={() => setOpen((isOpen) => !isOpen)}
            className="absolute inset-0 cursor-pointer rounded-[10px]"
          />

          {chips.length === 0 ? (
            <span className="pointer-events-none relative truncate text-muted-foreground">
              {placeholder}
            </span>
          ) : (
            <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2">
              {visibleChips.map((chip) => (
                <span
                  key={chip.option}
                  className="flex min-w-0 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-sm text-primary"
                >
                  <span className="min-w-0 truncate">{chip.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label}`}
                    onClick={() => toggle(chip.option, false)}
                    className="pointer-events-auto shrink-0 cursor-pointer"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
              {hiddenCount > 0 && (
                <span className="shrink-0 rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary">
                  +{hiddenCount} more
                </span>
              )}
            </span>
          )}

          <ChevronDown
            className="pointer-events-none relative ml-auto size-5 shrink-0 text-text-secondary"
            aria-hidden="true"
          />
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
        // Without this, a click on the trigger closes the panel as an
        // outside-click and the button's own handler immediately re-opens it.
        onInteractOutside={(event) => {
          if (triggerRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <div
          role="group"
          aria-label="Facility type options"
          className="flex max-h-72 flex-col gap-3 overflow-y-auto overscroll-contain [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:bg-border"
        >
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
