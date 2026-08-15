'use client';

import { useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { OTHER_OPTION_ID, type OnboardingOption } from '@/lib/constants/onboarding-options';

interface OptionChipSelectProps {
  options: readonly OnboardingOption[];
  /** Selected option ids; may include `OTHER_OPTION_ID`. */
  value: string[];
  onChange: (value: string[]) => void;
  /** Free text backing `OTHER_OPTION_ID`; ignored while it is unselected. */
  otherText: string;
  onOtherTextChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-label': string;
}

/** Chips shown before the rest collapse, so the trigger stays one row tall. */
const MAX_VISIBLE_CHIPS = 2;

/**
 * Dropdown multi-select over an onboarding option list. The closed state shows
 * the selections as removable chips; the panel is a checkbox list plus the
 * "Other" free-text row, mirroring the facility-type picker in Settings.
 */
export default function OptionChipSelect({
  options,
  value,
  onChange,
  otherText,
  onOtherTextChange,
  id,
  placeholder = 'Select an option',
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
}: OptionChipSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  const isOther = value.includes(OTHER_OPTION_ID);

  const chips = options
    .filter((option) => value.includes(option.id))
    .map((option) => ({
      id: option.id,
      // A checked-but-blank "Other" still yields a chip so the selection never
      // disappears mid-edit.
      label: option.id === OTHER_OPTION_ID ? otherText.trim() || option.label : option.label,
    }));
  const visibleChips = chips.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = chips.length - visibleChips.length;

  const toggle = (optionId: string, checked: boolean) =>
    onChange(checked ? [...value, optionId] : value.filter((entry) => entry !== optionId));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          ref={triggerRef}
          className={cn(
            'relative flex h-14 w-full items-center gap-2 rounded-[10px] border border-input bg-background px-4',
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
            aria-label={ariaLabel}
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
                  key={chip.id}
                  className="flex min-w-0 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-sm text-primary"
                >
                  <span className="min-w-0 truncate">{chip.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label}`}
                    onClick={() => toggle(chip.id, false)}
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
          aria-label={ariaLabel}
          className="flex max-h-72 flex-col gap-3 overflow-y-auto overscroll-contain [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:bg-border"
        >
          {options.map((option) => (
            <label key={option.id} className="flex cursor-pointer items-center gap-2.5">
              <Checkbox
                className="size-[18px] rounded-[5px]"
                checked={value.includes(option.id)}
                onCheckedChange={(checked) => toggle(option.id, checked === true)}
              />
              <span className="min-w-0 text-sm break-words text-foreground">{option.label}</span>
            </label>
          ))}

          {isOther && (
            <Input
              className="h-9 rounded-none border-0 border-b border-input px-0 text-sm shadow-none focus-visible:border-primary focus-visible:ring-0"
              placeholder="Please specify"
              aria-label={`Other ${ariaLabel}`}
              value={otherText}
              onChange={(event) => onOtherTextChange(event.target.value)}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
