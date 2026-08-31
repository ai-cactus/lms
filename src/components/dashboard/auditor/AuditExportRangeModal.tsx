'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';

export interface AuditExportRange {
  from?: string;
  to?: string;
}

interface AuditExportRangeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the chosen bounds; an all-empty range means "all time". */
  onGenerate: (range: AuditExportRange) => void;
}

// Audit ranges look backwards, so the pickers must allow the past rather than
// DatePicker's default "today" floor. Ten years back also gives the year
// dropdown a useful span (it counts forward from the minimum).
const YEARS_SELECTABLE_BACK = 10;

function minSelectableDate(): Date {
  return new Date(new Date().getFullYear() - YEARS_SELECTABLE_BACK, 0, 1);
}

function parseYmd(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function AuditExportRangeModal({
  open,
  onOpenChange,
  onGenerate,
}: AuditExportRangeModalProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const invalid = Boolean(from && to && from > to);

  // Every close path clears the draft, so a cancelled edit never lingers into
  // the next export.
  const close = () => {
    setFrom('');
    setTo('');
    onOpenChange(false);
  };

  const handleGenerate = () => {
    if (invalid) return;
    onGenerate({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent
        className="gap-0 sm:max-w-[464px]"
        onInteractOutside={(e) => {
          // DatePicker portals its calendar to <body>, so picking a day reads as
          // an "outside" interaction — keep the dialog open.
          const target = e.detail.originalEvent.target as HTMLElement | null;
          if (target?.closest('#date-picker-popover')) e.preventDefault();
        }}
      >
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-[18px] font-bold leading-7 text-[#0f172a]">
            Select date range
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-5 text-[#64748b]">
            Select a date range to generate your audit report. The file will be exported in CSV
            format.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium leading-5 text-[#0f172a]">From</span>
            <DatePicker
              value={from}
              onChange={setFrom}
              placeholder="MM/DD/YYYY"
              label="Export range start date"
              minDate={minSelectableDate()}
              showYearSelect
              className="h-11 rounded-[8px] border-[#e2e8f0] [&_span]:text-[14px]"
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium leading-5 text-[#0f172a]">To</span>
            <DatePicker
              value={to}
              onChange={setTo}
              placeholder="MM/DD/YYYY"
              label="Export range end date"
              minDate={parseYmd(from) ?? minSelectableDate()}
              showYearSelect
              className="h-11 rounded-[8px] border-[#e2e8f0] [&_span]:text-[14px]"
            />
          </div>
        </div>

        {invalid ? (
          <p className="mt-3 text-[12px] leading-5 text-error" role="alert">
            “From” must be on or before “To”.
          </p>
        ) : (
          <p className="mt-3 text-[12px] leading-5 text-[#94a3b8]">
            Generating this export may take a while depending on the scope selected.
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 rounded-[8px] border-[#e2e8f0] text-[14px] font-medium text-[#0f172a]"
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11 flex-1 rounded-[8px] text-[14px] font-semibold"
            disabled={invalid}
            onClick={handleGenerate}
          >
            Generate Report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
