'use client';

import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isValidEmail, parseEmailList, splitEmailTokens } from '@/lib/email-list';
import {
  buildStaffCsvTemplate,
  extractStaffEmailsFromRows,
  readStaffSpreadsheetRows,
} from '@/lib/staff-csv';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

/** One typeahead result — shaped like `searchStaffUsers`, its only supplier today. */
export interface AssigneeSuggestion {
  id: string;
  name: string;
  email: string;
  initials: string;
}

export interface AssigneesInputHandle {
  /** Commit whatever is typed, for a host that owns its own "add" button. */
  commitDraft: () => void;
}

interface AssigneesInputProps {
  /** The chosen recipients, lowercased. The host owns the list. */
  value: string[];
  onChange: (next: string[]) => void;
  /**
   * DOM id of the text field. Defaults to the `assign-input` both assign
   * surfaces have always carried — e2e specs drive it by that id directly.
   */
  inputId?: string;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Turns the suggestion dropdown on. The host supplies the search, so this
   * component binds to no server action of its own and stays testable.
   */
  onSearch?: (query: string) => Promise<AssigneeSuggestion[]>;
  /** Turns on CSV/XLSX upload, drag-and-drop and paste-to-parse. */
  enableBulkImport?: boolean;
  /** Collapse chips past this many behind a "+N more" chip. Omit to show every chip. */
  visibleChipLimit?: number;
  /** Extra classes for the chip container, so a host can match its own field metrics. */
  className?: string;
  ref?: React.Ref<AssigneesInputHandle>;
}

interface Notice {
  tone: 'error' | 'warning';
  text: string;
}

const COMMIT_KEYS = ['Enter', 'Tab', ',', ' '];
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

const SPREADSHEET_ACCEPT =
  '.csv,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default function AssigneesInput({
  value,
  onChange,
  inputId = 'assign-input',
  placeholder = 'Add people, emails or names',
  disabled = false,
  onSearch,
  enableBulkImport = false,
  visibleChipLimit,
  className,
  ref,
}: AssigneesInputProps) {
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [suggestions, setSuggestions] = useState<AssigneeSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [knownEmails, setKnownEmails] = useState<Set<string>>(new Set());

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => new Set(value.map((email) => email.toLowerCase())), [value]);

  const visibleEmails =
    visibleChipLimit === undefined || expanded ? value : value.slice(0, visibleChipLimit);
  const hiddenCount = value.length - visibleEmails.length;

  const addEmails = (emails: string[]) => {
    const seen = new Set(selected);
    const additions: string[] = [];
    for (const email of emails) {
      const lower = email.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      additions.push(lower);
    }
    if (additions.length > 0) onChange([...value, ...additions]);
  };

  /**
   * Adds every valid address and hands the rejected text back in the field
   * rather than dropping it: a bulk paste that loses two of forty addresses
   * without saying which is indistinguishable from one that worked.
   */
  const commitText = (text: string) => {
    const tokens = splitEmailTokens(text);
    if (tokens.length === 0) return;

    const { valid } = parseEmailList(text);
    const invalid = tokens.filter((token) => !isValidEmail(token));

    addEmails(valid);
    setDraft(invalid.join(', '));
    setShowSuggestions(false);
    setSuggestions([]);

    if (invalid.length === 0) {
      setNotice(null);
      return;
    }
    setNotice({
      tone: 'error',
      text:
        tokens.length === 1
          ? 'Please enter a valid email address'
          : `${invalid.length} of ${tokens.length} entries are not valid email addresses — they have been left in the field to fix or remove.`,
    });
  };

  useImperativeHandle(ref, () => ({ commitDraft: () => commitText(draft) }));

  useEffect(() => {
    if (!onSearch) return;
    const query = draft.trim();
    if (query.length < MIN_SEARCH_LENGTH) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setIsSearching(true);
      void onSearch(query)
        .then((results) => {
          if (cancelled) return;
          setSuggestions(results);
          setKnownEmails((prev) => {
            const updated = new Set(prev);
            results.forEach((result) => updated.add(result.email.toLowerCase()));
            return updated;
          });
        })
        .catch((err: unknown) => {
          logger.error({ msg: '[assign] Assignee search failed', err });
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, onSearch]);

  useEffect(() => {
    if (!onSearch) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onSearch]);

  const visibleSuggestions = suggestions.filter(
    (suggestion) => !selected.has(suggestion.email.toLowerCase()),
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
      setNotice(null);
      return;
    }
    // An empty field must still tab away, so only a pending draft is committed.
    if (!draft.trim() || !COMMIT_KEYS.includes(e.key)) return;
    e.preventDefault();
    commitText(draft);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!enableBulkImport) return;
    e.preventDefault();
    commitText(e.clipboardData.getData('text'));
  };

  const removeEmail = (email: string) => {
    onChange(value.filter((current) => current !== email));
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildStaffCsvTemplate()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'assign-course-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setNotice(null);
    try {
      const parsed = extractStaffEmailsFromRows(await readStaffSpreadsheetRows(file));

      if (parsed.validEmails.length === 0) {
        setNotice({
          tone: 'error',
          text: 'No valid email rows found in the file. Check the format or download the sample template.',
        });
        return;
      }

      addEmails(parsed.validEmails);

      if (parsed.invalidCount > 0 || parsed.truncated) {
        const parts: string[] = [];
        if (parsed.invalidCount > 0) {
          parts.push(`${parsed.invalidCount} row(s) skipped — invalid or duplicate email`);
        }
        if (parsed.truncated) parts.push('the file was truncated to the first 1000 rows');
        setNotice({ tone: 'warning', text: `${parts.join(' and ')}.` });
      }
    } catch (err) {
      logger.error({ msg: '[assign] Assignee spreadsheet parse failed', err });
      setNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to parse the uploaded file.',
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!enableBulkImport) return;
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="flex w-full flex-col">
      <div
        ref={wrapperRef}
        onClick={() => inputRef.current?.focus()}
        onDragOver={
          enableBulkImport
            ? (e) => {
                e.preventDefault();
                setIsDragging(true);
              }
            : undefined
        }
        onDragLeave={enableBulkImport ? () => setIsDragging(false) : undefined}
        onDrop={enableBulkImport ? handleDrop : undefined}
        className={cn(
          'relative flex min-h-[52px] w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border-[1.5px] bg-background px-[18px] py-2.5 transition-colors focus-within:border-primary md:min-h-[56px]',
          isDragging ? 'border-primary bg-primary/5' : 'border-border',
          className,
        )}
      >
        {visibleEmails.map((email) => {
          const isNewInvite = Boolean(onSearch) && !knownEmails.has(email.toLowerCase());
          return (
            <div
              key={email}
              className={cn(
                'flex max-w-full items-center rounded-2xl px-2.5 py-1 text-[13px] font-medium',
                isNewInvite ? 'bg-primary text-primary-foreground' : 'bg-accent text-foreground',
              )}
            >
              <span className="truncate">{email}</span>
              {isNewInvite && (
                <span className="ml-1.5 rounded-sm bg-background/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px]">
                  New
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${email}`}
                disabled={disabled}
                className="ml-1.5 flex h-auto items-center justify-center border-none bg-transparent p-0 text-[14px] leading-none text-text-secondary hover:text-error"
                onClick={(e) => {
                  e.stopPropagation();
                  removeEmail(email);
                }}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </Button>
            </div>
          );
        })}

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
            aria-label={`Show all ${value.length} recipients`}
            className="rounded-2xl bg-accent px-2.5 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/70"
          >
            +{hiddenCount} more
          </button>
        )}

        <input
          id={inputId}
          ref={inputRef}
          aria-label={placeholder}
          className="min-w-[120px] flex-1 border-none bg-transparent py-1 text-base text-foreground outline-none placeholder:text-muted-foreground md:text-[18px]"
          placeholder={value.length === 0 ? placeholder : ''}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setShowSuggestions(true)}
        />

        {onSearch &&
          showSuggestions &&
          (draft.trim().length >= MIN_SEARCH_LENGTH || visibleSuggestions.length > 0) && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-[200px] w-full overflow-y-auto rounded-md border border-border bg-background shadow-md">
              {isSearching ? (
                <div className="p-2.5 text-sm text-text-secondary">Searching...</div>
              ) : visibleSuggestions.length > 0 ? (
                visibleSuggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-background-secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      addEmails([suggestion.email]);
                      setDraft('');
                      setNotice(null);
                      setShowSuggestions(false);
                      setSuggestions([]);
                    }}
                  >
                    <div className="flex size-6 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-text-secondary">
                      {suggestion.initials}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">{suggestion.name}</span>
                      <span className="text-xs text-text-secondary">{suggestion.email}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-2.5 text-sm text-text-secondary">No staff found</div>
              )}
            </div>
          )}
      </div>

      {enableBulkImport && (
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isParsing}
            className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-primary disabled:opacity-60"
          >
            <Upload className="size-4" aria-hidden="true" />
            {isParsing ? 'Parsing…' : 'Click to upload .csv file instead'}
          </button>
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Download className="size-4" aria-hidden="true" />
            Download sample .csv template
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={SPREADSHEET_ACCEPT}
            className="hidden"
            aria-label="Upload a spreadsheet of recipients"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {notice && (
        <p
          aria-live="polite"
          className={cn('mt-1.5 text-sm', notice.tone === 'error' ? 'text-error' : 'text-warning')}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
