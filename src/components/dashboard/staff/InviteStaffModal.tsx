'use client';

import React, { useMemo, useState } from 'react';
import { X, Download, UploadCloud, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, FileUpload } from '@/components/ui';
import { Field } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createInvites } from '@/app/actions/invite';
import {
  readStaffSpreadsheetRows,
  extractStaffEmailsFromRows,
  buildStaffCsvTemplate,
  type StaffCsvParseResult,
} from '@/lib/staff-csv';
import { logger } from '@/lib/logger';
import { useRouter } from 'next/navigation';
import { GRANTABLE_ROLES, getRoleDisplayName } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

interface InviteStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * @deprecated No longer used — the target organization is derived server-side
   * from the authenticated admin session. Kept optional for caller compatibility.
   */
  organizationId?: string;
  /** Seats remaining under the current plan. null = unlimited (enterprise). */
  remainingSeats: number | null;
  planName: string;
  /** The current admin's role — determines which roles they may grant. */
  inviterRole: Role;
  /**
   * Emails already present as members or pending invites, used only to flag
   * such rows in the CSV import preview. The server action remains the source
   * of truth for seat limits and duplicate handling.
   */
  existingEmails?: string[];
}

export default function InviteStaffModal({
  isOpen,
  onClose,
  remainingSeats,
  planName,
  inviterRole,
  existingEmails = [],
}: InviteStaffModalProps) {
  const grantableRoles = GRANTABLE_ROLES[inviterRole];
  const isLimitedPlan = remainingSeats !== null;
  const seatsExhausted = isLimitedPlan && remainingSeats === 0;
  const [emails, setEmails] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role>('worker');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvParsing, setCsvParsing] = useState(false);
  const [parseResult, setParseResult] = useState<StaffCsvParseResult | null>(null);

  const router = useRouter();
  // Owner is seat-exempt (D2); every other role consumes a plan seat.
  const seatCapApplies = selectedRole !== 'owner';

  const knownEmails = useMemo(
    () => new Set(existingEmails.map((e) => e.toLowerCase())),
    [existingEmails],
  );

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  // Shared submit path — both the manual and CSV tabs funnel valid emails
  // through the same `createInvites` server action. Returns the number of
  // invites actually sent so the caller can clear its own input on success.
  const runInvites = async (finalEmails: string[]): Promise<number> => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await createInvites(finalEmails, selectedRole);

      if (!result.success) {
        setMessage({ type: 'error', text: result.error || 'Failed to send invites' });
        return 0;
      }

      const sent = result.results.filter(
        (r) => r.status === 'sent' || r.status === 'resent',
      ).length;
      const existed = result.results.filter((r) => r.status === 'exists').length;
      const errors = result.results.filter((r) => r.status === 'error').length;

      let text = '';
      if (sent > 0) text += `Sent ${sent} invite(s). `;
      if (existed > 0) text += `${existed} user(s) already exist. `;
      if (errors > 0) text += `${errors} failed. `;

      const type: 'success' | 'error' = errors > 0 ? 'error' : 'success';
      setMessage({ type, text: text.trim() || 'No changes were made.' });

      if (sent > 0) {
        setTimeout(() => {
          onClose();
          router.refresh();
        }, 2500);
      }

      return sent;
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
      return 0;
    } finally {
      setIsLoading(false);
    }
  };

  // ── Manual entry ───────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ' ', ','].includes(e.key)) {
      e.preventDefault();
      const val = inputValue.trim();
      if (val && isValidEmail(val)) {
        if (!emails.includes(val)) {
          setEmails([...emails, val]);
        }
        setInputValue('');
        setMessage(null);
      }
    } else if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
      setEmails(emails.slice(0, -1));
    }
  };

  const removeEmail = (emailToRemove: string) => {
    setEmails(emails.filter((email) => email !== emailToRemove));
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const finalEmails = [...emails];
    const currentVal = inputValue.trim();
    if (currentVal && isValidEmail(currentVal) && !finalEmails.includes(currentVal)) {
      finalEmails.push(currentVal);
    }

    if (finalEmails.length === 0) {
      setMessage({ type: 'error', text: 'Please enter at least one valid email address' });
      return;
    }

    const sent = await runInvites(finalEmails);
    if (sent > 0) {
      setEmails([]);
      setInputValue('');
    }
  };

  // ── CSV / bulk import ────────────────────────────────────────────────────────
  const downloadTemplate = () => {
    const blob = new Blob([buildStaffCsvTemplate()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'staff-invite-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCsvFile = async (files: File[]) => {
    if (files.length === 0) return;

    const file = files[0];
    setCsvParsing(true);
    setMessage(null);
    setParseResult(null);
    setCsvFileName(null);

    try {
      const rows = await readStaffSpreadsheetRows(file);
      const result = extractStaffEmailsFromRows(rows, { knownEmails });

      setCsvFileName(file.name);
      setParseResult(result);

      if (result.rows.length === 0) {
        setMessage({
          type: 'error',
          text: 'No email rows found in the file. Check the format or download the template.',
        });
      }
    } catch (err) {
      logger.error({ msg: '[staff] CSV bulk-import parse failed', err });
      setMessage({
        type: 'error',
        text: 'Failed to parse file. Please upload a valid .csv or .xlsx file.',
      });
    } finally {
      setCsvParsing(false);
    }
  };

  const clearCsv = () => {
    setCsvFileName(null);
    setParseResult(null);
    setMessage(null);
  };

  const handleCsvSubmit = async () => {
    if (!parseResult || parseResult.validEmails.length === 0) return;
    const sent = await runInvites(parseResult.validEmails);
    if (sent > 0) {
      clearCsv();
    }
  };

  // Owner is seat-exempt (D2); hide the seat hint when the selected role consumes no seat.
  const seatsHint =
    isLimitedPlan && seatCapApplies ? (
      <p
        className={
          seatsExhausted
            ? 'text-[13px] font-semibold text-error'
            : 'text-[13px] text-text-secondary'
        }
      >
        {seatsExhausted
          ? `Your ${planName} plan has no remaining worker seats. Please upgrade to invite more.`
          : `${remainingSeats} seat${remainingSeats !== 1 ? 's' : ''} remaining on your ${planName} plan.`}
      </p>
    ) : null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite New Staff</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="manual" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="manual">Enter emails</TabsTrigger>
            <TabsTrigger value="csv">Import CSV</TabsTrigger>
          </TabsList>

          <TabsContent value="manual">
            <form onSubmit={handleManualSubmit} className="flex flex-col gap-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-text-secondary">
                  Email Addresses
                </label>
                <div
                  className="flex min-h-[42px] flex-wrap items-center gap-2 rounded-[10px] border border-border bg-background p-2"
                  onClick={() => document.getElementById('email-chip-input')?.focus()}
                >
                  {emails.map((email) => (
                    <div
                      key={email}
                      className="flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeEmail(email);
                        }}
                        className="ml-1.5 flex items-center text-primary"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <input
                    id="email-chip-input"
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={emails.length === 0 ? 'Enter emails...' : ''}
                    className="min-w-[120px] flex-1 border-none bg-transparent text-sm text-foreground outline-none"
                  />
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  Press Space or Enter to add an email.
                </p>
              </div>

              {grantableRoles.length > 0 && (
                <Field label="Role">
                  <Select
                    value={selectedRole}
                    onValueChange={(value) => setSelectedRole(value as Role)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {grantableRoles.map((role) => (
                        <SelectItem key={role} value={role}>
                          {getRoleDisplayName(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {message && (
                <Alert variant={message.type === 'success' ? 'success' : 'error'}>
                  {message.text}
                </Alert>
              )}

              {seatsHint}

              <DialogFooter className="mt-2">
                <Button variant="outline" type="button" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  type="submit"
                  loading={isLoading}
                  disabled={
                    (emails.length === 0 && !inputValue) || (seatsExhausted && seatCapApplies)
                  }
                >
                  Send Invites
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="csv">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-text-secondary">
                  Upload a .csv or .xlsx file with an <span className="font-medium">email</span>{' '}
                  column.
                </p>
                <Button
                  variant="ghost"
                  type="button"
                  size="sm"
                  onClick={downloadTemplate}
                  className="shrink-0 gap-1.5 px-2 font-semibold text-primary"
                >
                  <Download className="size-4" aria-hidden="true" />
                  Template
                </Button>
              </div>

              {!parseResult ? (
                <div className="h-48">
                  <FileUpload
                    onFilesSelected={handleCsvFile}
                    multiple={false}
                    accept=".csv,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    description={
                      csvParsing ? 'Parsing file…' : '.csv or .xlsx files only. 10MB max.'
                    }
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background-secondary p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileSpreadsheet
                        className="size-5 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <span className="truncate text-sm font-medium text-foreground">
                        {csvFileName}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={clearCsv}
                      className="shrink-0 gap-1.5 px-2 text-text-secondary"
                    >
                      <UploadCloud className="size-4" aria-hidden="true" />
                      Replace
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    <span className="font-medium text-success">{parseResult.validCount} valid</span>
                    <span className="text-text-secondary">{parseResult.invalidCount} skipped</span>
                    {parseResult.duplicateCount > 0 && (
                      <span className="text-text-secondary">
                        {parseResult.duplicateCount} duplicate
                        {parseResult.duplicateCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {parseResult.truncated && (
                    <Alert variant="warning">
                      Only the first {parseResult.totalRows} rows were read. Split larger lists into
                      multiple files.
                    </Alert>
                  )}

                  {parseResult.rows.length > 0 && (
                    <ul className="max-h-52 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                      {parseResult.rows.map((row, index) => (
                        <li
                          key={`${row.email}-${index}`}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {row.valid ? (
                              <CheckCircle2
                                className="size-4 shrink-0 text-success"
                                aria-hidden="true"
                              />
                            ) : (
                              <AlertCircle
                                className="size-4 shrink-0 text-error"
                                aria-hidden="true"
                              />
                            )}
                            <span className="truncate text-foreground">{row.email}</span>
                          </span>
                          {!row.valid && (
                            <span className="shrink-0 text-xs text-error">{row.error}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {message && (
                <Alert variant={message.type === 'success' ? 'success' : 'error'}>
                  {message.text}
                </Alert>
              )}

              {seatsHint}

              <DialogFooter className="mt-2">
                <Button variant="outline" type="button" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  type="button"
                  onClick={handleCsvSubmit}
                  loading={isLoading}
                  disabled={
                    csvParsing ||
                    !parseResult ||
                    parseResult.validEmails.length === 0 ||
                    (seatsExhausted && seatCapApplies)
                  }
                >
                  {parseResult && parseResult.validCount > 0
                    ? `Send ${parseResult.validCount} Invite${parseResult.validCount !== 1 ? 's' : ''}`
                    : 'Send Invites'}
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
