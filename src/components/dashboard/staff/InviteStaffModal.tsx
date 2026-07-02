'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui';
import { Field } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createInvites } from '@/app/actions/invite';
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
}

export default function InviteStaffModal({
  isOpen,
  onClose,
  remainingSeats,
  planName,
  inviterRole,
}: InviteStaffModalProps) {
  const grantableRoles = GRANTABLE_ROLES[inviterRole];
  const isLimitedPlan = remainingSeats !== null;
  const seatsExhausted = isLimitedPlan && remainingSeats === 0;
  const [emails, setEmails] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role>('worker');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();
  // Owner is seat-exempt (D2); every other role consumes a plan seat.
  const seatCapApplies = selectedRole !== 'owner';

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

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
      // If invalid, do nothing (prevent space/enter)
    } else if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
      setEmails(emails.slice(0, -1));
    }
  };

  const removeEmail = (emailToRemove: string) => {
    setEmails(emails.filter((email) => email !== emailToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Add current input if valid
    const finalEmails = [...emails];
    const currentVal = inputValue.trim();
    if (currentVal && isValidEmail(currentVal) && !finalEmails.includes(currentVal)) {
      finalEmails.push(currentVal);
    }

    if (finalEmails.length === 0) {
      setMessage({ type: 'error', text: 'Please enter at least one valid email address' });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const result = await createInvites(finalEmails, selectedRole);

      if (result.success) {
        // Analyze results
        const sent = result.results.filter(
          (r) => r.status === 'sent' || r.status === 'resent',
        ).length;
        const existed = result.results.filter((r) => r.status === 'exists').length;
        const errors = result.results.filter((r) => r.status === 'error').length;

        let msgText = '';
        let type: 'success' | 'error' = 'success';

        if (sent > 0) msgText += `Sent ${sent} invite(s). `;
        if (existed > 0) msgText += `${existed} user(s) already exist. `;
        if (errors > 0) {
          msgText += `${errors} failed. `;
          type = 'error'; // Treat as error if any failed? Or maybe warning context?
          // If at least one sent, keep green but warn? Let's use neutral or just success if mixed.
          // If NOTHING sent and only errors/exists, maybe error color?
          if (sent === 0) type = 'error';
        }

        setMessage({ type, text: msgText.trim() });

        if (type === 'success' || sent > 0) {
          setEmails([]);
          setInputValue('');
          // Only close if everything was perfect? Or just give them time to read?
          // Let's rely on the timeout
          setTimeout(() => {
            onClose();
            router.refresh();
          }, 2500); // slightly longer to read
        }
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to send invites' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite New Staff</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
            <Alert variant={message.type === 'success' ? 'success' : 'error'}>{message.text}</Alert>
          )}

          {/* Seats remaining hint — owner is seat-exempt (D2), so hide when owner selected */}
          {isLimitedPlan && seatCapApplies && (
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
          )}

          <DialogFooter className="mt-2">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="default"
              type="submit"
              loading={isLoading}
              disabled={(emails.length === 0 && !inputValue) || (seatsExhausted && seatCapApplies)}
            >
              Send Invites
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
