'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  placeholder?: string;
  label?: string;
  minDate?: Date; // Dates before this are disabled
}

export default function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  minDate,
}: DatePickerProps) {
  // Default minDate to start of today if not provided
  const effectiveMinDate =
    minDate || new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

  const today = new Date();
  const [viewDate, setViewDate] = useState(() => {
    if (value) {
      const [y, m, d] = value.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return today;
  });

  // Close on outside click and position popover
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const popoverEl = document.getElementById('date-picker-popover');
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        popoverEl &&
        !popoverEl.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      window.addEventListener('mousedown', handleClickOutside);
      const updatePosition = () => {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          setPosition({
            top: rect.bottom + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width,
          });
        }
      };
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);

      return () => {
        window.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isOpen]);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const currentYear = viewDate.getFullYear();
  const currentMonth = viewDate.getMonth();
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewDate(new Date(currentYear, currentMonth - 1, 1));
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewDate(new Date(currentYear, currentMonth + 1, 1));
  };

  const handleDayClick = (day: number) => {
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${currentYear}-${monthStr}-${dayStr}`;
    onChange(dateStr);
    setIsOpen(false);
  };

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        className={cn(
          'flex h-14 w-full select-none items-center justify-between rounded-[10px] border bg-background px-4 text-left transition-colors',
          isOpen
            ? 'border-ring ring-[3px] ring-ring/50'
            : 'border-input hover:border-ring/60 hover:bg-background-secondary',
        )}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span
          className={cn(
            'text-base',
            value ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {value ? formatDateDisplay(value) : placeholder}
        </span>
        <Calendar className="size-[18px] text-text-tertiary" aria-hidden="true" />
      </button>

      {isOpen &&
        createPortal(
          <div
            id="date-picker-popover"
            role="dialog"
            aria-modal="true"
            aria-label="Calendar"
            className="absolute z-[9999] w-80 max-w-[calc(100vw-32px)] rounded-xl border border-border bg-background p-4 shadow-lg"
            style={{
              position: 'absolute',
              top: position.top + 8,
              left: position.left,
            }}
          >
            <div className="mb-5 flex items-center justify-between">
              <Button variant="ghost" size="icon-sm" onClick={handlePrevMonth}>
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <div className="text-base font-bold text-foreground">
                {monthNames[currentMonth]} {currentYear}
              </div>
              <Button variant="ghost" size="icon-sm" onClick={handleNextMonth}>
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {dayLabels.map((day) => (
                <div key={day} className="mb-2 text-xs font-semibold uppercase text-text-tertiary">
                  {day}
                </div>
              ))}

              {/* Empty cells for prev month offset */}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className="h-9" />
              ))}

              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const monthStr = String(currentMonth + 1).padStart(2, '0');
                const dayStr = String(day).padStart(2, '0');
                const dateStr = `${currentYear}-${monthStr}-${dayStr}`;
                const isSelected = value === dateStr;

                const isToday =
                  today.getDate() === day &&
                  today.getMonth() === currentMonth &&
                  today.getFullYear() === currentYear;

                const thisDate = new Date(currentYear, currentMonth, day);
                const isPast = thisDate < effectiveMinDate;

                return (
                  <button
                    key={day}
                    type="button"
                    className={cn(
                      'flex h-9 items-center justify-center rounded-lg text-sm font-medium transition-colors',
                      isSelected && 'bg-primary font-semibold text-primary-foreground shadow-sm',
                      isToday && !isSelected && 'font-bold text-primary',
                      isPast
                        ? 'cursor-not-allowed text-text-tertiary'
                        : !isSelected && 'text-foreground hover:bg-accent hover:text-foreground',
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isPast) handleDayClick(day);
                    }}
                    disabled={isPast}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
