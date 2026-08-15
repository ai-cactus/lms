'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  ChevronLeft,
  Trash2,
  Upload,
  Download,
  FileSpreadsheet,
  X,
} from 'lucide-react';
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
  extractManagerInvitesFromRows,
  buildStaffInviteCsvTemplate,
  summariseSkippedCsvRows,
} from '@/lib/staff-csv';
import { parseEmailList } from '@/lib/email-list';
import { logger } from '@/lib/logger';
import { useRouter } from 'next/navigation';
import { groupRolesForSelect, GRANTABLE_ROLES } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

/**
 * The facility fields this modal renders. Kept structural (rather than reusing
 * `AccessibleFacility`) so both mount points — the staff roster and Settings,
 * which carry different facility shapes — can pass their list unchanged.
 */
export interface InviteFacilityOption {
  id: string;
  name: string;
  type: string | null;
  city?: string | null;
}

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
  /** Facilities the inviter may target, listed under the always-present Global option. */
  facilities: InviteFacilityOption[];
}

interface Contact {
  email: string;
  name?: string;
  /** '' until the admin assigns a role in step 2. */
  role: Role | '';
}

type Step = 'input' | 'assign' | 'success';

/**
 * Sentinel for the org-wide option. Radix `Select` reserves the empty string for
 * "nothing selected", so Global needs a value of its own; it maps to an explicit
 * `facilityId: null` on the server.
 */
const GLOBAL_FACILITY_VALUE = '__global__';

export default function InviteStaffModal({
  isOpen,
  onClose,
  remainingSeats,
  planName,
  inviterRole,
  existingEmails = [],
  facilities,
}: InviteStaffModalProps) {
  const router = useRouter();
  const roleGroups = useMemo(() => groupRolesForSelect(inviterRole), [inviterRole]);
  // Roles this inviter may actually grant — used to scope CSV role pre-fill so an
  // ungrantable role in the file is never silently applied (left for manual pick).
  const grantableRoleSet = useMemo(
    () => new Set<string>(GRANTABLE_ROLES[inviterRole] ?? []),
    [inviterRole],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  const isLimitedPlan = remainingSeats !== null;
  const seatsExhausted = isLimitedPlan && remainingSeats === 0;

  const knownEmails = useMemo(
    () => new Set(existingEmails.map((e) => e.toLowerCase())),
    [existingEmails],
  );

  const [step, setStep] = useState<Step>('input');
  const [facilityChoice, setFacilityChoice] = useState('');
  const [facilityError, setFacilityError] = useState<string | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState('');
  const [skippedCount, setSkippedCount] = useState(0);
  const [csvContacts, setCsvContacts] = useState<Contact[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvParsing, setCsvParsing] = useState(false);
  const [csvWarning, setCsvWarning] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [invitedCount, setInvitedCount] = useState(0);

  // Valid emails still sitting uncommitted in the chip input's draft text — they
  // count immediately so Continue doesn't demand a trailing space/Enter first.
  const draftParsed = useMemo(() => parseEmailList(emailDraft), [emailDraft]);

  // Combined, de-duplicated importable emails from chips, draft text, and any CSV.
  const combinedEmails = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const email of [...emails, ...draftParsed.valid]) {
      if (!map.has(email)) map.set(email, { email, role: '' });
    }
    for (const contact of csvContacts) {
      // Preserve the role pre-filled from the CSV so the admin isn't forced to
      // re-pick roles the file already specified.
      if (!map.has(contact.email)) map.set(contact.email, { ...contact });
    }
    return [...map.values()];
  }, [emails, draftParsed.valid, csvContacts]);

  const addEmailsFromText = (text: string) => {
    const { valid, invalidCount } = parseEmailList(text);
    if (valid.length > 0) {
      setEmails((prev) => [...prev, ...valid.filter((email) => !prev.includes(email))]);
    }
    setSkippedCount(invalidCount);
    return invalidCount === 0;
  };

  const commitEmailDraft = () => {
    if (!emailDraft.trim()) return;
    if (addEmailsFromText(emailDraft)) setEmailDraft('');
  };

  const handleEmailKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      commitEmailDraft();
      return;
    }
    if (e.key === 'Backspace' && !emailDraft && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1));
    }
  };

  const handleEmailPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    addEmailsFromText(e.clipboardData.getData('text'));
    setEmailDraft('');
  };

  const removeEmail = (email: string) => {
    setEmails((prev) => prev.filter((entry) => entry !== email));
  };

  const selectedFacilityLabel =
    facilityChoice === GLOBAL_FACILITY_VALUE
      ? 'Global'
      : (facilities.find((facility) => facility.id === facilityChoice)?.name ?? '');

  const resetState = () => {
    setStep('input');
    setFacilityChoice('');
    setFacilityError(null);
    setEmails([]);
    setEmailDraft('');
    setSkippedCount(0);
    setCsvContacts([]);
    setCsvFileName(null);
    setCsvParsing(false);
    setCsvWarning(null);
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
    const blob = new Blob([buildStaffInviteCsvTemplate()], { type: 'text/csv;charset=utf-8;' });
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
    setCsvWarning(null);
    try {
      const rows = await readStaffSpreadsheetRows(file);
      const result = extractManagerInvitesFromRows(rows, { validRoles: grantableRoleSet });

      // Rows already a member / pending invite are flagged best-effort here so the
      // admin doesn't re-send; the server action stays the source of truth.
      const importable = result.invites.filter((inv) => !knownEmails.has(inv.email));
      const alreadyKnownCount = result.invites.length - importable.length;

      if (importable.length === 0) {
        const skipSummary = summariseSkippedCsvRows(result.skipped);
        setMessage({
          type: 'error',
          text: skipSummary
            ? `No new contacts to import. ${skipSummary}.`
            : 'No new email rows found in the file. Check the format or download the template.',
        });
        setCsvContacts([]);
        setCsvFileName(null);
        return;
      }

      setCsvContacts(
        importable.map((inv) => ({ email: inv.email, role: (inv.role || '') as Role | '' })),
      );
      setCsvFileName(file.name);

      const warnings: string[] = [];
      const skipSummary = summariseSkippedCsvRows(result.skipped);
      if (skipSummary) warnings.push(skipSummary);
      if (alreadyKnownCount > 0) {
        warnings.push(`${alreadyKnownCount} already a member or invited and skipped`);
      }
      const roleRejectedCount = importable.filter((inv) => inv.roleRejected).length;
      if (roleRejectedCount > 0) {
        warnings.push(
          `${roleRejectedCount} row${roleRejectedCount === 1 ? '' : 's'} had a role you can't assign — pick one below`,
        );
      }
      setCsvWarning(warnings.length > 0 ? `${warnings.join('. ')}.` : null);
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
    setCsvWarning(null);
    setMessage(null);
  };

  const goToAssign = () => {
    if (!facilityChoice) {
      setFacilityError('Select a facility before continuing.');
      return;
    }
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
      // `null` is the explicit "Global" marker — it tells the server not to fall
      // back to the inviter's own facility.
      const result = await createInvites(items, {
        facilityId: facilityChoice === GLOBAL_FACILITY_VALUE ? null : facilityChoice,
      });

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
      <DialogContent className="sm:max-w-[643px]" showCloseButton={step !== 'success'}>
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
              <label htmlFor="invite-facility" className="text-sm font-medium text-foreground">
                Facility
              </label>
              <Select
                value={facilityChoice}
                onValueChange={(value) => {
                  setFacilityChoice(value);
                  setFacilityError(null);
                }}
              >
                <SelectTrigger
                  id="invite-facility"
                  aria-invalid={!!facilityError}
                  className="h-11 w-full"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Building2 className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                    <SelectValue
                      className={`truncate ${facilityChoice ? 'text-[#5C47FF]' : ''}`}
                      placeholder="Select a facility"
                    >
                      {selectedFacilityLabel}
                    </SelectValue>
                  </span>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  align="start"
                  sideOffset={-20}
                  className="w-[var(--radix-select-trigger-width)] data-[side=bottom]:translate-y-0 flex flex-col gap-[1px]"
                >
                  <SelectItem
                    value={GLOBAL_FACILITY_VALUE}
                    className="py-[17px] px-[14px] cursor-pointer"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2 w-full">
                      <span
                        className={`font-medium text-[15px] ${
                          facilityChoice === GLOBAL_FACILITY_VALUE
                            ? 'text-[#5C47FF]'
                            : 'text-[#101928]'
                        }`}
                      >
                        Global
                      </span>
                      <span className="text-[13px] text-[#667085]">
                        &middot; For managerial roles including Admin, HR, Finance, Clinical/Quality
                        Director
                      </span>
                    </span>
                  </SelectItem>
                  {facilities.map((facility) => {
                    const meta = [facility.type, facility.city].filter(Boolean).join(' · ');
                    return (
                      <SelectItem
                        key={facility.id}
                        value={facility.id}
                        className="py-[17px] px-[14px] cursor-pointer w-full"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                          <span
                            className={`font-medium text-[15px] ${
                              facilityChoice === facility.id ? 'text-[#5C47FF]' : 'text-[#101928]'
                            }`}
                          >
                            {facility.name}
                          </span>
                          {meta && (
                            <span className="text-[13px] text-[#667085]">&middot; {meta}</span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {facilityError && <p className="text-xs text-error">{facilityError}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="invite-email-input" className="text-sm font-medium text-foreground">
                Email address
              </label>
              <div
                onClick={() => emailInputRef.current?.focus()}
                className="flex min-h-[110px] w-full cursor-text flex-wrap content-start items-start gap-2 rounded-[10px] border border-border bg-background p-3 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
              >
                {emails.map((email) => (
                  <span
                    key={email}
                    className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background-secondary px-2.5 py-1 text-sm text-foreground"
                  >
                    <span className="truncate">{email}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeEmail(email);
                      }}
                      className="shrink-0 text-text-secondary transition-colors hover:text-error"
                      aria-label={`Remove ${email}`}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                ))}
                <input
                  id="invite-email-input"
                  ref={emailInputRef}
                  type="text"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={handleEmailKeyDown}
                  onBlur={commitEmailDraft}
                  onPaste={handleEmailPaste}
                  placeholder={
                    emails.length === 0
                      ? 'Enter emails separated by commas, spaces, or new lines'
                      : ''
                  }
                  className="min-w-[140px] flex-1 border-none bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-text-secondary"
                />
              </div>
              {(combinedEmails.length > 0 || skippedCount > 0) && (
                <p className="text-xs text-text-secondary">
                  {combinedEmails.length} valid email{combinedEmails.length !== 1 ? 's' : ''} found
                  {skippedCount > 0 ? ` • ${skippedCount} skipped — not a valid email address` : ''}
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

            {csvWarning && (
              <Alert variant="warning" title="Some rows need attention">
                {csvWarning}
              </Alert>
            )}
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

            <div className="flex max-h-[320px] flex-col gap-0 divide-y divide-border overflow-y-auto overflow-x-hidden rounded-lg border border-border">
              {contacts.map((contact) => (
                <div key={contact.email} className="flex items-center gap-3 p-3">
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
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>

            {csvWarning && (
              <Alert variant="warning" title="Some rows need attention">
                {csvWarning}
              </Alert>
            )}
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
                {`Invite ${contacts.length} staff${contacts.length === 1 ? '' : 's'}`}
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
                {`${invitedCount} staff${invitedCount === 1 ? '' : 's'} invited.`} They&apos;ll get
                an email to join and start their assigned training.
              </DialogDescription>
            </div>
            <Button variant="default" type="button" className="w-full" onClick={handleClose}>
              Okay
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
