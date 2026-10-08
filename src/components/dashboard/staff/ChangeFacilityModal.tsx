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
import { Checkbox } from '@/components/ui/checkbox';
import { setStaffFacilities } from '@/app/actions/staff';
import { cn } from '@/lib/utils';
import type { AccessibleFacility } from '@/lib/facility/scope';

export interface ChangeFacilityMember {
  /** OrganizationUser id — the membership whose assignments are rewritten. */
  id: string;
  name: string;
  email: string;
  /** A short-lived signed URL (see `signAvatarUrl`), never the stored storage URI. */
  avatarUrl: string | null;
  /** The member's active facilities, oldest first. */
  currentFacilities: { id: string; name: string }[];
}

interface ChangeFacilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: ChangeFacilityMember;
  facilities: AccessibleFacility[];
}

/**
 * Sets every facility a facility-bound staff member belongs to.
 *
 * `setStaffFacilities` replaces the member's assignments with exactly the ids it
 * is sent, so this modal always sends the full intended set — starting from the
 * member's current facilities — never a single "move" target, which would
 * silently drop a member of several facilities down to one.
 *
 * Seeded from `member` on mount: callers mount it per member (keyed, or only
 * while open) so the selection never carries over from someone else.
 */
export default function ChangeFacilityModal({
  isOpen,
  onClose,
  member,
  facilities,
}: ChangeFacilityModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(member.currentFacilities.map((facility) => facility.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const currentIds = new Set(member.currentFacilities.map((facility) => facility.id));
  const viewerFacilityIds = new Set(facilities.map((facility) => facility.id));
  // A current facility outside the viewer's list can't be offered as a choice,
  // but dropping it from the payload would revoke it, so it is kept and locked.
  const lockedFacilities = member.currentFacilities.filter(
    (facility) => !viewerFacilityIds.has(facility.id),
  );
  const options = [
    ...facilities.map((facility) => ({
      id: facility.id,
      name: facility.name,
      meta:
        [facility.type, facility.city].filter(Boolean).join(' · ') || 'No type or city recorded',
      locked: false,
    })),
    ...lockedFacilities.map((facility) => ({
      id: facility.id,
      name: facility.name,
      meta: 'Outside the facilities you manage',
      locked: true,
    })),
  ];

  const added = options.filter(
    (option) => selectedIds.has(option.id) && !currentIds.has(option.id),
  );
  const removed = member.currentFacilities.filter((facility) => !selectedIds.has(facility.id));
  const unchanged = added.length === 0 && removed.length === 0;

  const currentLabel =
    member.currentFacilities.length > 2
      ? `${member.currentFacilities.length} facilities`
      : member.currentFacilities.map((facility) => facility.name).join(', ');

  const toggle = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const close = () => {
    setStep('select');
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (selectedIds.size === 0) return;
    setIsSaving(true);
    setError(null);

    const result = await setStaffFacilities(member.id, [...selectedIds]);

    setIsSaving(false);
    if (result.success) {
      close();
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to update facilities.');
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[614px]">
        {step === 'select' ? (
          <>
            <DialogHeader>
              <DialogTitle>Change facilities</DialogTitle>
              <DialogDescription>
                Choose every facility this staff member should belong to.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background-secondary p-4">
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
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-semibold text-foreground">
                  {member.name || member.email}
                </span>
                <span className="truncate text-xs text-text-secondary">{member.email}</span>
              </div>
              {currentLabel && (
                <span
                  className="max-w-full truncate rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
                  title={member.currentFacilities.map((facility) => facility.name).join(', ')}
                >
                  Current &middot; {currentLabel}
                </span>
              )}
            </div>

            <div
              role="group"
              aria-label="Facilities"
              className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border"
            >
              {options.map((option) => {
                const checked = selectedIds.has(option.id);
                return (
                  <label
                    key={option.id}
                    className={cn(
                      'flex min-w-0 items-center gap-3 p-3.5 transition-colors',
                      option.locked
                        ? 'cursor-not-allowed'
                        : checked
                          ? 'cursor-pointer bg-primary/5'
                          : 'cursor-pointer hover:bg-accent',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={option.locked}
                      onCheckedChange={(value) => toggle(option.id, value === true)}
                    />
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={cn(
                          'truncate text-sm font-semibold',
                          checked ? 'text-primary' : 'text-foreground',
                        )}
                        title={option.name}
                      >
                        {option.name}
                      </span>
                      <span className="truncate text-xs text-text-secondary" title={option.meta}>
                        &bull; {option.meta}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <p className="text-sm text-text-secondary">
              {
                "The staff's training records will be preserved. All completed courses and certificates will remain accessible on this profile."
              }
            </p>

            {error && <Alert variant="error">{error}</Alert>}

            <DialogFooter className="grid grid-cols-2 gap-3 sm:flex sm:justify-end">
              <Button
                variant="outline"
                type="button"
                onClick={close}
                className="h-12 w-full border border-border bg-background sm:w-[178px]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={selectedIds.size === 0 || unchanged}
                onClick={() => {
                  setError(null);
                  setStep('confirm');
                }}
                className="h-12 w-full sm:w-[178px]"
              >
                Review changes
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                Update facilities for &ldquo;{member.name || member.email}&rdquo;?
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-col gap-1">
                  {added.length > 0 && (
                    <p>
                      <span className="font-semibold text-foreground">Adding:</span>{' '}
                      {added.map((facility) => facility.name).join(', ')}
                    </p>
                  )}
                  {removed.length > 0 && (
                    <p>
                      <span className="font-semibold text-foreground">Removing:</span>{' '}
                      {removed.map((facility) => facility.name).join(', ')}
                    </p>
                  )}
                  <p>Are you sure you want to perform this action?</p>
                </div>
              </DialogDescription>
            </DialogHeader>

            {error && <Alert variant="error">{error}</Alert>}

            <DialogFooter className="grid grid-cols-2 gap-3 sm:flex sm:justify-end">
              <Button
                variant="outline"
                type="button"
                onClick={() => setStep('select')}
                disabled={isSaving}
                className="h-12 w-full border border-border bg-background sm:w-[178px]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                loading={isSaving}
                className="h-12 w-full sm:w-[178px]"
              >
                Update facilities
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
