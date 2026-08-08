'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { SupervisorOption } from '@/app/actions/organization';

interface SupervisorComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  options: SupervisorOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/**
 * Picks the supervisor for a facility: either an existing one from the
 * organization or a brand-new email address. It is deliberately BOTH a filter
 * over the roster and a free-text email field — inviting someone who has no
 * account yet is the common case, so the list must never become a constraint.
 */
export function SupervisorCombobox({
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  className,
  disabled,
  id,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: SupervisorComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const query = value.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) return options;
    return options.filter(
      (option) =>
        option.email.toLowerCase().includes(query) ||
        (option.fullName?.toLowerCase().includes(query) ?? false),
    );
  }, [options, query]);

  const selected = options.find((option) => option.email.toLowerCase() === query);
  const highlighted = activeIndex >= 0 && activeIndex < filtered.length ? activeIndex : -1;

  const select = (option: SupervisorOption) => {
    onChange(option.email);
    setActiveIndex(-1);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
      return;
    }

    if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }

    // Only swallow Enter while an option is highlighted, so the key still
    // submits the form when the field is being used as plain email entry.
    if (event.key === 'Enter' && open && highlighted >= 0) {
      event.preventDefault();
      select(filtered[highlighted]);
    }
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div ref={wrapperRef} className="relative w-full">
            <Input
              id={id}
              type="text"
              inputMode="email"
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                highlighted >= 0
                  ? `${listboxId}-${filtered[highlighted].organizationUserId}`
                  : undefined
              }
              aria-invalid={ariaInvalid}
              aria-describedby={ariaDescribedBy}
              disabled={disabled}
              placeholder={placeholder}
              className={cn('pr-12', className)}
              value={value}
              onChange={(event) => {
                onChange(event.target.value);
                setActiveIndex(-1);
                setOpen(true);
              }}
              onBlur={onBlur}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-label="Show supervisors"
              onClick={() => setOpen((isOpen) => !isOpen)}
              className="absolute inset-y-0 right-0 flex cursor-pointer items-center pr-4 text-text-secondary disabled:cursor-not-allowed"
            >
              <ChevronDown className="size-5" aria-hidden="true" />
            </button>
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          sideOffset={4}
          className="max-h-60 w-(--radix-popover-trigger-width) overflow-y-auto p-1"
          // Focus must stay in the input: the field is still being typed into
          // while the list is open, so neither opening nor clicking the trigger
          // area may steal it or dismiss the list.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (wrapperRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-secondary">
              {options.length === 0 ? 'No supervisors yet.' : 'No matching supervisor.'}
            </p>
          ) : (
            <ul id={listboxId} role="listbox" aria-label="Existing supervisors">
              {filtered.map((option, index) => (
                <li key={option.organizationUserId}>
                  <button
                    id={`${listboxId}-${option.organizationUserId}`}
                    type="button"
                    role="option"
                    aria-selected={selected?.organizationUserId === option.organizationUserId}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(option)}
                    className={cn(
                      'flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left',
                      index === highlighted && 'bg-accent',
                    )}
                  >
                    {option.fullName && (
                      <span className="text-sm font-medium text-foreground">{option.fullName}</span>
                    )}
                    <span className="text-sm text-text-secondary">{option.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      {selected?.fullName && (
        <p className="text-sm text-text-secondary">Existing supervisor: {selected.fullName}</p>
      )}
    </div>
  );
}
