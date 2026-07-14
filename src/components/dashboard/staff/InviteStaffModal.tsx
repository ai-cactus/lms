'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, Trash2, Upload, Download, FileSpreadsheet } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createInvites } from '@/app/actions/invite';
import {
  readStaffSpreadsheetRows,
  extractStaffEmailsFromRows,
  buildStaffCsvTemplate,
} from '@/lib/staff-csv';
import { logger } from '@/lib/logger';
import { useRouter } from 'next/navigation';
import { groupRolesForSelect } from '@/lib/rbac/role-utils';
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
   * such rows during CSV import. The server action remains the source of truth
   * for seat limits and duplicate handling.
   */
  existingEmails?: string[];
}

interface Contact {
  email: string;
  name?: string;
  /** '' until the admin assigns a role in step 2. */
  role: Role | '';
}

type Step = 'input' | 'assign' | 'success';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmailText(text: string): { valid: string[]; invalidCount: number } {
  const tokens = text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;

  for (const token of tokens) {
    if (!EMAIL_REGEX.test(token)) {
      invalidCount++;
      continue;
    }
    const lower = token.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    valid.push(lower);
  }

  return { valid, invalidCount };
}

export default function InviteStaffModal({
  isOpen,
  onClose,
  remainingSeats,
  planName,
  inviterRole,
  existingEmails = [],
}: InviteStaffModalProps) {
  const router = useRouter();
  const roleGroups = useMemo(() => groupRolesForSelect(inviterRole), [inviterRole]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLimitedPlan = remainingSeats !== null;
  const seatsExhausted = isLimitedPlan && remainingSeats === 0;

  const knownEmails = useMemo(
    () => new Set(existingEmails.map((e) => e.toLowerCase())),
    [existingEmails],
  );

  const [step, setStep] = useState<Step>('input');
  const [emailText, setEmailText] = useState('');
  const [csvContacts, setCsvContacts] = useState<Contact[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvParsing, setCsvParsing] = useState(false);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [invitedCount, setInvitedCount] = useState(0);

  const textParsed = useMemo(() => parseEmailText(emailText), [emailText]);

  // Combined, de-duplicated importable emails from both the textarea and any CSV.
  const combinedEmails = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const email of textParsed.valid) {
      if (!map.has(email)) map.set(email, { email, role: '' });
    }
    for (const contact of csvContacts) {
      if (!map.has(contact.email)) map.set(contact.email, { ...contact, role: '' });
    }
    return [...map.values()];
  }, [textParsed.valid, csvContacts]);

  const resetState = () => {
    setStep('input');
    setEmailText('');
    setCsvContacts([]);
    setCsvFileName(null);
    setCsvParsing(false);
    setContacts([]);
    setIsLoading(false);
    setMessage(null);
    setInvitedCount(0);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // ── Step 1 — CSV import ──────────────────────────────────────────────────────
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

  const handleCsvFile = async (file: File) => {
    setCsvParsing(true);
    setMessage(null);
    try {
      const rows = await readStaffSpreadsheetRows(file);
      const result = extractStaffEmailsFromRows(rows, { knownEmails });

      if (result.validEmails.length === 0) {
        setMessage({
          type: 'error',
          text: 'No new email rows found in the file. Check the format or download the template.',
        });
        setCsvContacts([]);
        setCsvFileName(null);
        return;
      }

      setCsvContacts(result.validEmails.map((email) => ({ email, role: '' })));
      setCsvFileName(file.name);
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

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleCsvFile(file);
    e.target.value = '';
  };

  const clearCsv = () => {
    setCsvContacts([]);
    setCsvFileName(null);
    setMessage(null);
  };

  const goToAssign = () => {
    if (combinedEmails.length === 0) return;
    setContacts(combinedEmails);
    setMessage(null);
    setStep('assign');
  };

  // ── Step 2 — role assignment ─────────────────────────────────────────────────
  const setAllRoles = (role: Role) => {
    setContacts((prev) => prev.map((c) => ({ ...c, role })));
  };

  const setContactRole = (email: string, role: Role) => {
    setContacts((prev) => prev.map((c) => (c.email === email ? { ...c, role } : c)));
  };

  const removeContact = (email: string) => {
    setContacts((prev) => prev.filter((c) => c.email !== email));
  };

  const allAssigned = contacts.length > 0 && contacts.every((c) => c.role !== '');

  const backToInput = () => {
    setMessage(null);
    setStep('input');
  };

  const submitInvites = async () => {
    if (!allAssigned) return;
    setIsLoading(true);
    setMessage(null);

    try {
      const items = contacts.map((c) => ({ email: c.email, role: c.role as Role }));
      const result = await createInvites(items);

      if (!result.success) {
        setMessage({ type: 'error', text: result.error || 'Failed to send invites' });
        return;
      }

      const sent = result.results.filter(
        (r) => r.status === 'sent' || r.status === 'resent',
      ).length;
      const existed = result.results.filter((r) => r.status === 'exists').length;
      const forbidden = result.results.filter((r) => r.status === 'forbidden').length;
      const errored = result.results.filter((r) => r.status === 'error').length;
      const issues = existed + forbidden + errored;

      if (sent > 0) router.refresh();

      if (issues === 0 && sent > 0) {
        setInvitedCount(sent);
        setStep('success');
        return;
      }

      // Partial (or total) failure — keep the admin on the assign step and
      // surface a per-status breakdown so they can adjust and retry.
      const parts: string[] = [];
      if (sent > 0) parts.push(`${sent} invited`);
      if (existed > 0) parts.push(`${existed} already a member or invited`);
      if (forbidden > 0) parts.push(`${forbidden} could not be granted the selected role`);
      if (errored > 0) parts.push(`${errored} failed to send`);
      setMessage({
        type: sent > 0 ? 'success' : 'error',
        text: parts.join(' • ') || 'No changes were made.',
      });
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  const roleOptions = (
    <>
      {roleGroups.map((group) => (
        <SelectGroup key={group.label}>
          <SelectLabel className="uppercase tracking-wide">{group.label}</SelectLabel>
          {group.roles.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.displayName}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );

  const seatsHint = isLimitedPlan ? (
    <p
      className={
        seatsExhausted ? 'text-[13px] font-semibold text-error' : 'text-[13px] text-text-secondary'
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
        if (!open) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={step !== 'success'}>
        {step === 'input' && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-lg font-semibold text-foreground">
                Invite New Staffs
              </DialogTitle>
              <DialogDescription className="text-sm text-text-secondary">
                Add the emails of people to invite, or upload a CSV. We&apos;ll pull out the
                contacts so you can assign roles.
              </DialogDescription>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="invite-email-textarea"
                className="text-sm font-medium text-foreground"
              >
                Email address
              </label>
              <textarea
                id="invite-email-textarea"
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                placeholder="Enter emails separated by commas, spaces, or new lines"
                className="min-h-[110px] w-full resize-y rounded-[10px] border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-[color,box-shadow] placeholder:text-text-secondary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              {(combinedEmails.length > 0 || textParsed.invalidCount > 0) && (
                <p className="text-xs text-text-secondary">
                  {combinedEmails.length} valid email{combinedEmails.length !== 1 ? 's' : ''} found
                  {textParsed.invalidCount > 0 ? ` • ${textParsed.invalidCount} skipped` : ''}
                </p>
              )}
            </div>

            {csvFileName ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background-secondary p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <FileSpreadsheet className="size-5 shrink-0 text-success" aria-hidden="true" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {csvFileName}
                    </span>
                    <span className="text-xs text-success">
                      {csvContacts.length} contact{csvContacts.length !== 1 ? 's' : ''} imported
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearCsv}
                  className="shrink-0 text-text-secondary transition-colors hover:text-error"
                  aria-label="Remove uploaded file"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={csvParsing}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary disabled:opacity-60"
                >
                  <Upload className="size-4" aria-hidden="true" />
                  {csvParsing ? 'Parsing…' : 'Click to upload .csv file instead'}
                </button>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-foreground cursor-pointer"
                >
                  <Download className="size-4" aria-hidden="true" />
                  Download sample .csv template
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={onFileInputChange}
            />

            {message && (
              <Alert variant={message.type === 'success' ? 'success' : 'error'}>
                {message.text}
              </Alert>
            )}
            {seatsHint}

            <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" type="button" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="default"
                type="button"
                onClick={goToAssign}
                disabled={combinedEmails.length === 0 || (seatsExhausted && isLimitedPlan)}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'assign' && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={backToInput}
                  className="rounded-md text-text-secondary transition-colors hover:text-foreground"
                  aria-label="Back to email entry"
                >
                  <ChevronLeft className="size-5" aria-hidden="true" />
                </button>
                <DialogTitle className="text-lg font-semibold text-foreground">
                  Assign roles
                </DialogTitle>
              </div>
              <DialogDescription className="pl-7 text-sm text-text-secondary">
                {`${contacts.length} contact${contacts.length !== 1 ? 's' : ''} found. Assign a role to each — they'll be invited by email.`}
              </DialogDescription>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg bg-background-secondary px-3 py-2.5">
              <span className="text-sm font-medium text-foreground">Set every role to</span>
              <Select onValueChange={(value) => setAllRoles(value as Role)}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>{roleOptions}</SelectContent>
              </Select>
            </div>

            <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto">
              {contacts.map((contact) => (
                <div
                  key={contact.email}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {contact.name ?? contact.email}
                    </span>
                    {contact.name && (
                      <span className="truncate text-xs text-text-secondary">{contact.email}</span>
                    )}
                  </div>
                  <Select
                    value={contact.role}
                    onValueChange={(value) => setContactRole(contact.email, value as Role)}
                  >
                    <SelectTrigger className="w-[170px] shrink-0">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>{roleOptions}</SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeContact(contact.email)}
                    className="shrink-0 text-text-secondary transition-colors hover:text-error"
                    aria-label={`Remove ${contact.email}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>

            {message && (
              <Alert variant={message.type === 'success' ? 'success' : 'error'}>
                {message.text}
              </Alert>
            )}
            {seatsHint}

            <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" type="button" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="default"
                type="button"
                onClick={submitInvites}
                loading={isLoading}
                disabled={!allAssigned || (seatsExhausted && isLimitedPlan)}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-success/10 ring-8 ring-success/5">
              <div className="flex size-11 items-center justify-center rounded-full bg-success text-white">
                <Check className="size-6" aria-hidden="true" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-lg font-semibold text-foreground">
                Invite sent
              </DialogTitle>
              <DialogDescription className="text-sm text-text-secondary">
                {`${invitedCount} ${invitedCount === 1 ? 'person has' : 'people have'} been invited.`}{' '}
                They&apos;ll get an email to join and start their assigned training.
              </DialogDescription>
            </div>
            <Button variant="default" type="button" className="w-full" onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
