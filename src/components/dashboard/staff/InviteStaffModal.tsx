'use client';

import React, { useId, useMemo, useRef, useState } from 'react';
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
import { groupRolesForSelect, getRoleDisplayName, GRANTABLE_ROLES } from '@/lib/rbac/role-utils';
import { rolesForInvitePath, type InvitePath } from '@/lib/facility/invite-role-path';
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
  // Roles this inviter may actually grant — used to scope CSV role pre-fill so an
  // ungrantable role in the file is never silently applied (left for manual pick).
  const grantableRoleSet = useMemo(
    () => new Set<string>(GRANTABLE_ROLES[inviterRole] ?? []),
    [inviterRole],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const bulkHintId = useId();

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
  const [rolesClearedByPathChange, setRolesClearedByPathChange] = useState(false);
  const [csvRoleMismatchCount, setCsvRoleMismatchCount] = useState(0);
  const [bulkRole, setBulkRole] = useState<Role | ''>('');
  const [bulkAnnouncement, setBulkAnnouncement] = useState('');
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

  const invitePath: InvitePath = facilityChoice === GLOBAL_FACILITY_VALUE ? 'global' : 'facility';
  const pathRoles = useMemo(
    () => rolesForInvitePath(invitePath, GRANTABLE_ROLES[inviterRole] ?? []),
    [invitePath, inviterRole],
  );
  const roleGroups = useMemo(
    () => groupRolesForSelect(inviterRole, pathRoles),
    [inviterRole, pathRoles],
  );

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
    setRolesClearedByPathChange(false);
    setCsvRoleMismatchCount(0);
    setBulkRole('');
    setBulkAnnouncement('');
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

    // Roles picked on an earlier visit to this step survive Back; the CSV's
    // pre-fill applies only where nothing was picked. Either kind is blanked
    // when it doesn't fit the facility now chosen, since the facility may have
    // been picked (or changed) after the roles were.
    const pickedRoles = new Map(contacts.map((c) => [c.email, c.role]));
    let pickedCleared = 0;
    let csvCleared = 0;
    const nextContacts = combinedEmails.map((contact): Contact => {
      const picked = pickedRoles.get(contact.email) || '';
      const role = picked || contact.role;
      if (!role || pathRoles.includes(role)) return { ...contact, role };
      if (picked) pickedCleared += 1;
      else csvCleared += 1;
      return { ...contact, role: '' };
    });
    const bulkRoleCleared = bulkRole !== '' && !pathRoles.includes(bulkRole);
    if (bulkRoleCleared) setBulkRole('');

    setContacts(nextContacts);
    setRolesClearedByPathChange(pickedCleared > 0 || bulkRoleCleared);
    setCsvRoleMismatchCount(csvCleared);
    setMessage(null);
    setStep('assign');
  };

  // ── Step 2 — role assignment ─────────────────────────────────────────────────
  const applyBulkRole = () => {
    if (!bulkRole) return;
    setContacts((prev) => prev.map((c) => ({ ...c, role: bulkRole })));
    setBulkAnnouncement(`Role set to ${getRoleDisplayName(bulkRole)} for ${contacts.length} staff`);
  };

  const setContactRole = (email: string, role: Role) => {
    setContacts((prev) => prev.map((c) => (c.email === email ? { ...c, role } : c)));
  };

  const removeContact = (email: string) => {
    setContacts((prev) => prev.filter((c) => c.email !== email));
    setBulkAnnouncement('');
  };

  const allAssigned = contacts.length > 0 && contacts.every((c) => c.role !== '');

  const backToInput = () => {
    setMessage(null);
    setBulkAnnouncement('');
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
      const forbiddenResults = result.results.filter((r) => r.status === 'forbidden');
      const forbidden = forbiddenResults.length;
      const errored = result.results.filter((r) => r.status === 'error').length;
      const refused = result.results.filter((r) => r.status === 'refused').length;
      const issues = existed + forbidden + errored + refused;

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
      if (forbidden > 0) {
        const reasons = [
          ...new Set(forbiddenResults.map((r) => r.message).filter((m): m is string => !!m)),
        ];
        parts.push(
          reasons.length === 1
            ? `${forbidden} not invited: ${reasons[0]}`
            : `${forbidden} could not be invited with the selected role and facility`,
        );
      }
      if (errored > 0) parts.push(`${errored} failed to send`);
      if (refused > 0) parts.push(`${refused} can't be invited. Contact support`);
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

  const assignCsvWarning =
    [
      csvWarning,
      csvRoleMismatchCount > 0
        ? `${csvRoleMismatchCount} row${csvRoleMismatchCount === 1 ? '' : 's'} had a role that doesn't fit the selected facility — pick one below.`
        : null,
    ]
      .filter(Boolean)
      .join(' ') || null;

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
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-[643px]"
        showCloseButton={step !== 'success'}
      >
        {step === 'input' && (
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-lg font-semibold text-foreground">
                Invite New Staff
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
                      className={`truncate ${facilityChoice ? 'text-primary' : ''}`}
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
                            ? 'text-primary'
                            : 'text-foreground'
                        }`}
                      >
                        Global
                      </span>
                      <span className="text-[13px] text-muted-foreground">
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
                              facilityChoice === facility.id ? 'text-primary' : 'text-foreground'
                            }`}
                          >
                            {facility.name}
                          </span>
                          {meta && (
                            <span className="text-[13px] text-muted-foreground">
                              &middot; {meta}
                            </span>
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
                className="flex max-h-[160px] min-h-[110px] w-full cursor-text overflow-y-auto flex-wrap content-start items-start gap-2 rounded-[10px] border border-border bg-background p-3 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
              >
                {emails.map((email) => (
                  <span
                    key={email}
                    className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background-secondary px-2.5 py-1 text-sm text-foreground"
                  >
                    <span className="min-w-0 truncate">{email}</span>
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
                  {csvParsing ? 'Parsing…' : 'Click to upload .csv file'}
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
                Assign role
              </Button>
            </div>
          </div>
        )}

        {step === 'assign' && (
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
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
              <span className="rounded-md border border-border px-2 py-0.5 text-sm text-text-secondary">
                {`${contacts.length} staff on this list`}
              </span>
              <DialogDescription className="sr-only">
                Choose a role for each person, then send the invites.
              </DialogDescription>
            </div>

            {contacts.length === 0 ? (
              <p className="rounded-lg border border-border p-6 text-center text-sm text-text-secondary">
                No staff left on this list.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">
                      {`Bulk assign a role to all ${contacts.length} staff`}
                    </span>
                    <span id={bulkHintId} className="text-xs text-text-secondary">
                      This will instantly apply the selected role to everyone in the list below
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:shrink-0">
                    <Select value={bulkRole} onValueChange={(value) => setBulkRole(value as Role)}>
                      <SelectTrigger
                        aria-label="Role to apply to everyone"
                        className="w-full bg-background sm:w-[190px]"
                      >
                        <SelectValue placeholder="Choose a role" />
                      </SelectTrigger>
                      <SelectContent>{roleOptions}</SelectContent>
                    </Select>
                    <Button
                      variant="default"
                      type="button"
                      className="w-full sm:w-auto"
                      onClick={applyBulkRole}
                      disabled={!bulkRole}
                      aria-describedby={bulkHintId}
                    >
                      Apply to all
                    </Button>
                  </div>
                </div>
                <p role="status" aria-live="polite" className="sr-only">
                  {bulkAnnouncement}
                </p>

                <div className="flex items-center gap-3 text-sm text-text-secondary">
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  or assign individually
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                </div>

                <div
                  role="table"
                  aria-label="Staff to invite"
                  className="overflow-hidden rounded-lg border border-border"
                >
                  <div role="rowgroup" className="hidden sm:block">
                    <div
                      role="row"
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border bg-background-secondary px-4 py-2.5 text-sm font-medium text-text-secondary"
                    >
                      <span role="columnheader">Name</span>
                      <span role="columnheader" className="w-[218px]">
                        Role
                      </span>
                    </div>
                  </div>
                  <div
                    role="rowgroup"
                    className="max-h-[320px] divide-y divide-border overflow-y-auto overflow-x-hidden"
                  >
                    {contacts.map((contact) => (
                      <div
                        key={contact.email}
                        role="row"
                        className="relative grid grid-cols-1 gap-2 p-4 pr-10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3 sm:pr-4"
                      >
                        <div role="cell" className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-foreground">
                            {contact.name ?? contact.email}
                          </span>
                          {contact.name && (
                            <span className="truncate text-xs text-text-secondary">
                              {contact.email}
                            </span>
                          )}
                        </div>
                        <div role="cell" className="flex items-center gap-3">
                          <Select
                            value={contact.role}
                            onValueChange={(value) => setContactRole(contact.email, value as Role)}
                          >
                            <SelectTrigger
                              aria-label={`Role for ${contact.email}`}
                              className="w-full sm:w-[190px]"
                            >
                              <SelectValue placeholder="Choose a role" />
                            </SelectTrigger>
                            <SelectContent>{roleOptions}</SelectContent>
                          </Select>
                          <button
                            type="button"
                            onClick={() => removeContact(contact.email)}
                            className="absolute top-4 right-4 shrink-0 text-text-secondary transition-colors hover:text-error sm:static"
                            aria-label={`Remove ${contact.email}`}
                          >
                            <X className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {rolesClearedByPathChange && (
              <Alert variant="warning">
                Some roles were cleared because they aren&apos;t available for the selected
                facility.
              </Alert>
            )}
            {assignCsvWarning && (
              <Alert variant="warning" title="Some rows need attention">
                {assignCsvWarning}
              </Alert>
            )}
            {message && (
              <Alert variant={message.type === 'success' ? 'success' : 'error'}>
                {message.text}
              </Alert>
            )}
            {seatsHint}

            <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                type="button"
                className="w-full sm:w-auto"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                type="button"
                className="w-full sm:w-auto"
                onClick={submitInvites}
                loading={isLoading}
                disabled={!allAssigned || (seatsExhausted && isLimitedPlan)}
              >
                {`Invite ${contacts.length} staff`}
              </Button>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="flex min-w-0 flex-col items-center gap-4 py-4 text-center">
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
                {`${invitedCount} staff invited.`} They&apos;ll get an email to join and start their
                assigned training.
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
