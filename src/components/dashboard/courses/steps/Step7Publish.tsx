'use client';

import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import DatePicker from '@/components/ui/DatePicker';
import TimePicker from '@/components/ui/TimePicker';
import { Button } from '@/components/ui/button';

import { CourseWizardData } from '@/types/course';
import { searchStaffUsers } from '@/app/actions/user';
import { logger } from '@/lib/logger';

interface Step7PublishProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

interface Worker {
  id: string;
  name: string;
  email: string;
  initials: string;
}

export default function Step7Publish({ data, onChange }: Step7PublishProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<Worker[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [knownEmails, setKnownEmails] = useState<Set<string>>(new Set()); // Track existing org members
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (inputValue.length >= 2) {
        setIsLoading(true);
        try {
          const results = await searchStaffUsers(inputValue);
          setKnownEmails((prev) => {
            const updated = new Set(prev);
            results.forEach((w: Worker) => updated.add(w.email));
            return updated;
          });
          // Filter out already assigned
          const available = results.filter((w: Worker) => !data.assignments?.includes(w.email));
          setSuggestions(available);
        } catch (err) {
          logger.error({ msg: 'Failed to search staff', err: err });
        } finally {
          setIsLoading(false);
        }
      } else {
        setSuggestions([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inputValue, data.assignments]);

  const [validationError, setValidationError] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const val = inputValue.trim();
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (isValidEmail) {
        addAssignment(val);
        setValidationError('');
      } else if (val) {
        setValidationError('Please enter a valid email address');
      }
      return;
    }

    if (['Enter', 'Tab', ','].includes(e.key)) {
      e.preventDefault();
      if (val) {
        if (isValidEmail) {
          addAssignment(val);
          setValidationError('');
        } else {
          setValidationError('Please enter a valid email address');
        }
      }
    } else if (e.key === 'Backspace' && !inputValue && data.assignments?.length > 0) {
      const newAssignments = [...(data.assignments || [])];
      newAssignments.pop();
      onChange('assignments', newAssignments);
      setValidationError('');
    }
  };

  const addAssignment = (value: string) => {
    if (!value) return;
    const current = data.assignments || [];
    if (!current.includes(value)) {
      onChange('assignments', [...current, value]);
    }
    setInputValue('');
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const removeAssignment = (index: number) => {
    const current = data.assignments || [];
    const newAssignments = current.filter((_: string, i: number) => i !== index);
    onChange('assignments', newAssignments);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative z-[50] flex w-full max-w-[800px] flex-col items-center transition-[max-width] duration-300 ease-in-out">
      <h2 className="mb-5 flex-shrink-0 text-center text-[32px] font-bold tracking-[-0.5px] text-foreground font-[family-name:var(--font-heading)]">
        Finalize &amp; Publish
      </h2>
      <p className="mb-[30px] max-w-[600px] flex-shrink-0 text-center text-base leading-[1.5] text-text-secondary">
        Assign this course to your team members and set a due date for completion.
      </p>

      <div className="w-full max-w-[600px]">
        <div className="mb-8">
          <label className="mb-2 block flex-shrink-0 text-sm text-text-secondary">Assign to</label>
          <div
            className="relative flex w-full min-h-[48px] cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 transition-all focus-within:border-primary focus-within:shadow-[0_0_0_2px_rgba(76,110,245,0.1)]"
            ref={wrapperRef}
            onClick={() => document.getElementById('assign-input')?.focus()}
          >
            {(data.assignments || []).map((item: string, index: number) => {
              const isNewInvite = !knownEmails.has(item);
              return (
                <div
                  key={index}
                  className={`flex items-center rounded-2xl px-2.5 py-1 text-[13px] font-medium ${
                    isNewInvite
                      ? 'border-[#764ba2] bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white'
                      : 'bg-[#edf2f7] text-foreground'
                  }`}
                >
                  {item}
                  {isNewInvite && (
                    <span className="ml-1.5 rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-white">
                      New
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-1.5 flex h-auto items-center justify-center border-none bg-transparent p-0 text-[14px] leading-none text-text-secondary hover:text-error"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAssignment(index);
                    }}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </Button>
                </div>
              );
            })}
            <input
              id="assign-input"
              className="min-w-[120px] flex-1 border-none py-1 text-sm text-foreground outline-none"
              placeholder={data.assignments?.length === 0 ? 'Type a name or email...' : ''}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setShowSuggestions(true);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowSuggestions(true)}
            />

            {showSuggestions && (inputValue.length >= 2 || suggestions.length > 0) && (
              <div className="absolute left-0 top-full z-[50] mt-1 max-h-[200px] w-full overflow-y-auto rounded-lg border border-border bg-background shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]">
                {isLoading ? (
                  <div className="p-2.5 text-sm text-text-secondary">Searching...</div>
                ) : suggestions.length > 0 ? (
                  suggestions.map((worker) => (
                    <div
                      key={worker.id}
                      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[#f7fafc]"
                      onClick={() => addAssignment(worker.email)}
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#cbd5e0] text-[10px] font-bold text-white">
                        {worker.initials}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">{worker.name}</span>
                        <span className="text-xs text-text-secondary">{worker.email}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  inputValue.length >= 2 && (
                    <div className="p-2.5 text-sm text-text-secondary">No staff found</div>
                  )
                )}
              </div>
            )}
          </div>
          <div className="mt-2.5 w-full flex-shrink-0 text-center text-xs font-medium text-text-secondary">
            Type an email and press Enter. New emails will receive an invite with login credentials.
          </div>
          {validationError && (
            <div className="mt-1.5 text-[13px] text-error">{validationError}</div>
          )}
        </div>

        <div className="mb-6 grid w-full grid-cols-[200px_1fr] items-center gap-5">
          <div className="flex w-full flex-col gap-2">
            <label className="mb-2 block flex-shrink-0 text-sm text-text-secondary">Due Date</label>
            <DatePicker value={data.dueDate || ''} onChange={(val) => onChange('dueDate', val)} />
          </div>
          <div className="flex w-full flex-col gap-2">
            <label className="mb-2 block flex-shrink-0 text-sm text-text-secondary">Due Time</label>
            <TimePicker value={data.dueTime || ''} onChange={(val) => onChange('dueTime', val)} />
          </div>
        </div>
      </div>
    </div>
  );
}
