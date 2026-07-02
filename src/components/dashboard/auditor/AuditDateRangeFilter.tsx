'use client';

import { useState } from 'react';
import { CalendarRange, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { cn } from '@/lib/utils';
import type { AuditDateRange } from './AuditFilterProvider';
import { EMPTY_RANGE, isRangeActive } from './AuditFilterProvider';

interface AuditDateRangeFilterProps {
  value: AuditDateRange;
  onChange: (range: AuditDateRange) => void;
  className?: string;
}

// Earliest selectable date — audit ranges look backwards, so allow the full past.
const MIN_SELECTABLE = new Date(2000, 0, 1);

const PRESETS: { label: string; days: number }[] = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseYmd(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatLabel(value: string): string {
  const date = parseYmd(value);
  if (!date) return '…';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function triggerLabel(range: AuditDateRange): string {
  if (!isRangeActive(range)) return 'All time';
  return `${range.from ? formatLabel(range.from) : 'Earliest'} – ${
    range.to ? formatLabel(range.to) : 'Latest'
  }`;
}

export default function AuditDateRangeFilter({
  value,
  onChange,
  className,
}: AuditDateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AuditDateRange>(value);

  // Re-seed the draft from the committed value each time the popover opens, so a
  // cancelled (un-applied) edit never lingers into the next session.
  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(value);
    setOpen(next);
  };

  const active = isRangeActive(value);
  const invalid = Boolean(draft.from && draft.to && draft.from > draft.to);

  const applyPreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    onChange({ from: toYmd(from), to: toYmd(to) });
    setOpen(false);
  };

  const clear = () => {
    onChange(EMPTY_RANGE);
    setDraft(EMPTY_RANGE);
    setOpen(false);
  };

  const apply = () => {
    if (invalid) return;
    onChange(draft);
    setOpen(false);
  };

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn('h-11 gap-2', active && 'border-primary/50 text-foreground')}
            aria-label="Filter by date range"
          >
            <CalendarRange className="size-4 text-text-tertiary" aria-hidden="true" />
            <span className="max-w-[180px] truncate">{triggerLabel(value)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-[320px] max-w-[calc(100vw-32px)] p-4"
          onInteractOutside={(e) => {
            // The nested DatePicker portals its calendar to <body>, so selecting
            // a day reads as an "outside" interaction — keep this popover open.
            const target = e.detail.originalEvent.target as HTMLElement | null;
            if (target?.closest('#date-picker-popover')) e.preventDefault();
          }}
        >
          <div className="mb-3 flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.days}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => applyPreset(preset.days)}
              >
                {preset.label}
              </Button>
            ))}
            <Button
              type="button"
              variant={active ? 'outline' : 'secondary'}
              size="sm"
              className="h-8 text-xs"
              onClick={clear}
            >
              All time
            </Button>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-secondary">From</label>
              <DatePicker
                value={draft.from}
                onChange={(from) => setDraft((prev) => ({ ...prev, from }))}
                placeholder="Start date"
                minDate={MIN_SELECTABLE}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-secondary">To</label>
              <DatePicker
                value={draft.to}
                onChange={(to) => setDraft((prev) => ({ ...prev, to }))}
                placeholder="End date"
                minDate={parseYmd(draft.from) ?? MIN_SELECTABLE}
              />
            </div>

            {invalid && <p className="text-xs text-error">“From” must be on or before “To”.</p>}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              Clear
            </Button>
            <Button type="button" size="sm" disabled={invalid} onClick={apply}>
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {active && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Clear date filter"
          onClick={clear}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
