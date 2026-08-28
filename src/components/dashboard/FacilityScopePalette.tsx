'use client';

import React from 'react';
import { Check, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AccessibleFacility } from '@/lib/facility/scope';

interface FacilityScopePaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilities: AccessibleFacility[];
  /** Ids in scope when the palette opens; the working selection starts here. */
  selectedFacilityIds: string[];
  /** Training Completion % per facility — absent facilities render an em dash. */
  completionPercentByFacilityId?: Record<string, number>;
  /** Called with the chosen ids: none = org-wide, one = drill-down, 2+ = compare. */
  onApply: (facilityIds: string[]) => void;
}

/** Rows matching the query on name, type or city. An empty query matches all. */
export function filterFacilities(
  facilities: AccessibleFacility[],
  query: string,
): AccessibleFacility[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return facilities;
  return facilities.filter((facility) =>
    [facility.name, facility.type, facility.city].some((field) =>
      field?.toLowerCase().includes(needle),
    ),
  );
}

/** Add or remove `facilityId`, leaving the rest of the selection untouched. */
export function toggleFacilityId(selectedIds: string[], facilityId: string): string[] {
  return selectedIds.includes(facilityId)
    ? selectedIds.filter((id) => id !== facilityId)
    : [...selectedIds, facilityId];
}

function facilitySubtitle(facility: AccessibleFacility): string {
  return [facility.type, facility.city].filter(Boolean).join(' · ');
}

/**
 * The facility scope palette: search, quick-pick chips and a multi-select
 * list over the caller's accessible facilities. It only ever reports the chosen
 * ids — the scope itself is URL state written by the caller.
 */
export default function FacilityScopePalette({
  open,
  onOpenChange,
  facilities,
  selectedFacilityIds,
  completionPercentByFacilityId,
  onApply,
}: FacilityScopePaletteProps) {
  const listboxId = React.useId();
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState('');
  const [selectedIds, setSelectedIds] = React.useState<string[]>(selectedFacilityIds);
  const [activeIndex, setActiveIndex] = React.useState(0);

  // Each opening starts from the scope currently in the URL, discarding whatever
  // the previous (dismissed) session left behind.
  const openingSelection = selectedFacilityIds.join(',');
  React.useEffect(() => {
    if (!open) return;
    setSelectedIds(openingSelection ? openingSelection.split(',') : []);
    setQuery('');
    setActiveIndex(0);
  }, [open, openingSelection]);

  const visibleFacilities = React.useMemo(
    () => filterFacilities(facilities, query),
    [facilities, query],
  );

  const selectedCount = selectedIds.length;
  const isSelected = (facilityId: string) => selectedIds.includes(facilityId);

  const toggle = (facilityId: string) => {
    setSelectedIds((current) => toggleFacilityId(current, facilityId));
  };

  const apply = () => {
    if (selectedIds.length === 0) return;
    const applied = facilities
      .filter((facility) => selectedIds.includes(facility.id))
      .map((facility) => facility.id);
    onOpenChange(false);
    onApply(applied);
  };

  // With the footer button disabled at zero selections, the "All facilities"
  // chip is the way back to the org-wide view — it applies immediately.
  const applyAllFacilities = () => {
    setSelectedIds([]);
    onOpenChange(false);
    onApply([]);
  };

  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setActiveIndex(0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (visibleFacilities.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(
        (current) => (current + step + visibleFacilities.length) % visibleFacilities.length,
      );
      return;
    }

    // Enter and space belong to the search field: on a chip or the footer button
    // they are the browser's own activation keys and must stay that way.
    if (event.target !== searchRef.current) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      apply();
      return;
    }

    // Space only selects while the query is empty — mid-search it is a character.
    if (event.key === ' ' && query.length === 0) {
      const facility = visibleFacilities[activeIndex];
      if (!facility) return;
      event.preventDefault();
      toggle(facility.id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onKeyDown={handleKeyDown}
        className="w-[calc(100%-1.5rem)] gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-lg sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">Switch facility scope</DialogTitle>
        <DialogDescription className="sr-only">
          Search your facilities, then view one on its own or compare several.
        </DialogDescription>

        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <Search className="size-[18px] shrink-0 text-text-secondary" aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={
              visibleFacilities[activeIndex]
                ? `${listboxId}-${visibleFacilities[activeIndex].id}`
                : undefined
            }
            aria-label="Search facilities"
            autoComplete="off"
            placeholder="Search facilities..."
            value={query}
            onChange={handleQueryChange}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-secondary"
          />
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-background-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-4 py-3">
          <button
            type="button"
            onClick={applyAllFacilities}
            aria-pressed={selectedCount === 0}
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              selectedCount === 0
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border bg-background text-foreground hover:bg-background-secondary',
            )}
          >
            {selectedCount === 0 && <Check className="size-3.5" aria-hidden="true" />}
            All facilities
          </button>
          {facilities.map((facility) => (
            <button
              key={facility.id}
              type="button"
              onClick={() => toggle(facility.id)}
              aria-pressed={isSelected(facility.id)}
              className={cn(
                'inline-flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                isSelected(facility.id)
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-background text-foreground hover:bg-background-secondary',
              )}
            >
              {isSelected(facility.id) && <Check className="size-3.5" aria-hidden="true" />}
              <span className="truncate">{facility.name}</span>
            </button>
          ))}
        </div>

        <ul
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Facilities"
          className="max-h-[45vh] overflow-y-auto p-2 sm:max-h-[320px]"
        >
          {visibleFacilities.map((facility, index) => {
            const selected = isSelected(facility.id);
            const completionPercent = completionPercentByFacilityId?.[facility.id];
            const subtitle = facilitySubtitle(facility);
            return (
              <li
                key={facility.id}
                id={`${listboxId}-${facility.id}`}
                role="option"
                aria-selected={selected}
                onClick={() => toggle(facility.id)}
                onMouseMove={() => setActiveIndex(index)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5',
                  index === activeIndex && 'bg-background-secondary',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-[18px] shrink-0 items-center justify-center rounded-[6px] border',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background text-transparent',
                  )}
                >
                  <Check className="size-3" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {facility.name}
                  </span>
                  {subtitle && (
                    <span className="truncate text-xs text-text-secondary">{subtitle}</span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-semibold text-foreground">
                  {completionPercent === undefined ? '—' : `${completionPercent}%`}
                </span>
              </li>
            );
          })}
          {visibleFacilities.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-text-secondary">
              No facilities match your search
            </li>
          )}
        </ul>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3">
          <Button
            size="sm"
            onClick={apply}
            disabled={selectedCount === 0}
            className="h-10 px-4 disabled:bg-primary/40 disabled:text-primary-foreground"
          >
            {selectedCount === 0
              ? 'Select facilities'
              : selectedCount === 1
                ? 'Select 1 facility'
                : `Select ${selectedCount} facilities`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
