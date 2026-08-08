'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { setStaffFacilities } from '@/app/actions/staff';
import { cn } from '@/lib/utils';
import type { AccessibleFacility } from '@/lib/facility/scope';

export interface ChangeFacilityMember {
  /** OrganizationUser id — the membership whose assignments are rewritten. */
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  currentFacilityName: string | null;
}

interface ChangeFacilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: ChangeFacilityMember;
  facilities: AccessibleFacility[];
}

/**
 * Moves a staff member to a single facility.
 *
 * The schema keeps multi-facility membership; this is the convenience "move"
 * affordance from the design, so it sends exactly one facility id and the server
 * deactivates the rest.
 */
export default function ChangeFacilityModal({
  isOpen,
  onClose,
  member,
  facilities,
}: ChangeFacilityModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const target = facilities.find((facility) => facility.id === targetId) ?? null;

  const close = () => {
    setStep('select');
    setTargetId('');
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!target) return;
    setIsSaving(true);
    setError(null);

    const result = await setStaffFacilities(member.id, [target.id]);

    setIsSaving(false);
    if (result.success) {
      close();
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to change facility.');
      setStep('select');
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {step === 'select' ? (
          <>
            <DialogHeader>
              <DialogTitle>Change facility</DialogTitle>
              <DialogDescription>
                Choose the facility this staff member should belong to.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-3 rounded-xl border border-border bg-background-secondary p-4">
              <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-text-secondary">
                {member.avatarUrl ? (
                  <Image
                    src={member.avatarUrl}
                    alt=""
                    width={44}
                    height={44}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-semibold">
                    {(member.name.charAt(0) || member.email.charAt(0)).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-semibold text-foreground">
                  {member.name || member.email}
                </span>
                <span className="truncate text-xs text-text-secondary">{member.email}</span>
              </div>
              {member.currentFacilityName && (
                <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                  Current &middot; {member.currentFacilityName}
                </span>
              )}
            </div>

            <RadioGroup
              value={targetId}
              onValueChange={setTargetId}
              aria-label="Target facility"
              className="gap-2"
            >
              {facilities.map((facility) => (
                <label
                  key={facility.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors hover:bg-accent',
                    facility.id === targetId ? 'border-primary bg-primary/5' : 'border-border',
                  )}
                >
                  <RadioGroupItem value={facility.id} className="mt-1" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {facility.name}
                    </span>
                    <span className="truncate text-xs text-text-secondary">
                      {[facility.type, facility.city].filter(Boolean).join(' · ') ||
                        'No type or city recorded'}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>

            <p className="text-sm text-text-secondary">
              {
                "The staff's training records will be preserved. All completed courses and certificates will remain accessible on this profile."
              }
            </p>

            {error && <Alert variant="error">{error}</Alert>}

            <DialogFooter>
              <Button variant="ghost" type="button" onClick={close}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!target}
                onClick={() => {
                  setError(null);
                  setStep('confirm');
                }}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                Switch &ldquo;{member.name || member.email}&rdquo; from &ldquo;
                {member.currentFacilityName ?? 'No facility'}&rdquo; to &ldquo;{target?.name}
                &rdquo;?
              </DialogTitle>
              <DialogDescription>
                {
                  "The staff's training records will be preserved. All completed courses and certificates will remain accessible on this profile."
                }
              </DialogDescription>
            </DialogHeader>

            {error && <Alert variant="error">{error}</Alert>}

            <DialogFooter>
              <Button
                variant="ghost"
                type="button"
                onClick={() => setStep('select')}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleConfirm} loading={isSaving}>
                Switch facility
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
