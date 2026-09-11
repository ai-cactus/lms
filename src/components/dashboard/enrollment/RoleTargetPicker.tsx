'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { setRoleAssignmentTargets } from '@/app/actions/enrollment';
import { getRoleDisplayName, groupRolesForSelect } from '@/lib/rbac/role-utils';
import { logger } from '@/lib/logger';
import type { UserRole } from '@/generated/prisma/enums';

/**
 * Where the picker is mounted, and therefore what a change means.
 *
 * `draft` — nothing is persisted yet (the course wizard, and the assign page for
 * a course that has no {@link CourseAssignment} row). The selection is the
 * caller's to submit.
 *
 * `live` — an assignment row already exists and every tick writes through
 * immediately, so the control is also the revoke surface (D5: the card that used
 * to carry revoke is gone, and revoke has to live somewhere reachable).
 */
export type RoleTargetPickerMode =
  | { kind: 'draft' }
  | {
      kind: 'live';
      assignmentId: string;
      /** Enrollments this assignment has already produced — named in the D6 confirm. */
      enrolledCount: number;
      /** The viewer holds `assignment.create`, so roles may be added. */
      canCreate: boolean;
      /** The viewer holds `assignment.delete`, so roles may be removed. */
      canRevoke: boolean;
    };

interface RoleTargetPickerProps {
  selectedRoles: UserRole[];
  onSelectionChange: (roles: UserRole[]) => void;
  mode: RoleTargetPickerMode;
  /** Current headcount per role, so the caller can preview the enrollment reach. */
  roleHolderCounts?: Record<string, number>;
  disabled?: boolean;
  /** Called with a live-mode refusal or failure, for the host page's error slot. */
  onLiveUpdateError?: (message: string) => void;
}

/**
 * The assignable role catalog, grouped exactly as the design's dropdown is
 * ("MANAGERS" / "WORKERS / LEARNERS"). Derived from the RBAC registry via an
 * Owner's grant matrix, which is every role an organisation can hold except
 * `owner` itself (one seat, established at org creation — never a course target).
 */
const ROLE_GROUPS = groupRolesForSelect('owner');
const MANAGER_ROLES: UserRole[] =
  ROLE_GROUPS.find((group) => group.label === 'Managers')?.roles.map((role) => role.value) ?? [];
const WORKER_ROLES: UserRole[] =
  ROLE_GROUPS.find((group) => group.label === 'Workers / Learners')?.roles.map(
    (role) => role.value,
  ) ?? [];
const ASSIGNABLE_ROLES: UserRole[] = [...MANAGER_ROLES, ...WORKER_ROLES];

const LIVE_UPDATE_FALLBACK = 'We could not update the targeted roles. Please try again.';

/** What a pending removal is retracting, so the confirm can name it. */
interface PendingRemoval {
  next: UserRole[];
  label: string;
}

export default function RoleTargetPicker({
  selectedRoles,
  onSelectionChange,
  mode,
  roleHolderCounts,
  disabled = false,
  onLiveUpdateError,
}: RoleTargetPickerProps) {
  const [open, setOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isLive = mode.kind === 'live';
  const canAdd = !disabled && (!isLive || mode.canCreate);
  const canRemove = !disabled && (!isLive || mode.canRevoke);
  const busy = disabled || isPending;

  /**
   * Persist a live selection, or hand a draft one straight back to the caller.
   * The selection is only reported once the write succeeds, so a refusal leaves
   * the boxes exactly as the viewer found them.
   */
  const commit = (next: UserRole[], onSettled?: (ok: boolean, message?: string) => void) => {
    if (mode.kind === 'draft') {
      onSelectionChange(next);
      onSettled?.(true);
      return;
    }

    const { assignmentId } = mode;
    startTransition(async () => {
      try {
        const result = await setRoleAssignmentTargets(assignmentId, next);
        if (!result.success) {
          const message = result.refusedReason ?? LIVE_UPDATE_FALLBACK;
          onLiveUpdateError?.(message);
          onSettled?.(false, message);
          return;
        }
        onSelectionChange(next);
        onSettled?.(true);
      } catch (err) {
        logger.error({ msg: '[enrollment] Role-target update failed', err, assignmentId });
        onLiveUpdateError?.(LIVE_UPDATE_FALLBACK);
        onSettled?.(false, LIVE_UPDATE_FALLBACK);
      }
    });
  };

  /**
   * Route a selection change by direction: adding retracts nothing and applies
   * straight away, while removing in live mode goes behind the D6 confirm that
   * states the consequence.
   */
  const requestChange = (next: UserRole[], removalLabel: string | null) => {
    if (busy) return;
    if (removalLabel === null) {
      commit(next);
      return;
    }
    if (!canRemove) return;
    if (!isLive) {
      // Nothing is enrolled before publish, so there is no consequence to state.
      commit(next);
      return;
    }
    setDialogError('');
    setPendingRemoval({ next, label: removalLabel });
  };

  // Rebuilt from the catalog so the stored order stays stable however the boxes
  // are ticked.
  const withCatalogOrder = (roles: UserRole[]) =>
    ASSIGNABLE_ROLES.filter((role) => roles.includes(role));

  const toggleRole = (role: UserRole, checked: boolean) => {
    if (checked) {
      if (!canAdd) return;
      requestChange(withCatalogOrder([...selectedRoles, role]), null);
      return;
    }
    requestChange(
      selectedRoles.filter((selected) => selected !== role),
      getRoleDisplayName(role),
    );
  };

  /**
   * D4: the EVERYONE rows are not a stored bucket — ticking one checks every
   * concrete role it covers and drops a chip for each, so `targetRoles` holds the
   * expanded list. A role added to the enum later is therefore not retroactively
   * included.
   */
  const toggleGroup = (group: UserRole[], label: string, checked: boolean) => {
    if (checked) {
      if (!canAdd) return;
      requestChange(withCatalogOrder([...selectedRoles, ...group]), null);
      return;
    }
    requestChange(
      selectedRoles.filter((role) => !group.includes(role)),
      label,
    );
  };

  const isGroupSelected = (group: UserRole[]) =>
    group.length > 0 && group.every((role) => selectedRoles.includes(role));

  // D3: "None" is the default and clears the selection. It is mutually exclusive
  // with any concrete role, and purely a UI state — an empty target list is what
  // gets persisted, never a "none" value.
  const noneSelected = selectedRoles.length === 0;
  const selectNone = () => {
    if (noneSelected) return;
    requestChange([], 'a targeted role');
  };

  const confirmRemoval = () => {
    if (!pendingRemoval) return;
    setDialogError('');
    commit(pendingRemoval.next, (ok, message) => {
      if (ok) setPendingRemoval(null);
      else setDialogError(message ?? LIVE_UPDATE_FALLBACK);
    });
  };

  const holderTotal = roleHolderCounts
    ? selectedRoles.reduce((total, role) => total + (roleHolderCounts[role] ?? 0), 0)
    : null;

  return (
    <div className="relative w-full" ref={containerRef}>
      <div
        className={`flex min-h-[52px] w-full flex-wrap items-center gap-1.5 rounded-[12px] border-[1.5px] bg-background px-[18px] py-2.5 transition-colors md:min-h-[56px] ${
          open ? 'border-primary' : 'border-border'
        } ${busy ? 'opacity-60' : ''}`}
      >
        {selectedRoles.map((role) => (
          <span
            key={role}
            className="flex items-center gap-1.5 rounded-2xl bg-primary/10 px-2.5 py-1 text-[13px] font-medium text-primary"
          >
            {getRoleDisplayName(role)}
            {canRemove && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${getRoleDisplayName(role)}`}
                className="flex h-auto items-center justify-center border-none bg-transparent p-0 text-primary hover:text-error"
                disabled={busy}
                onClick={() => toggleRole(role, false)}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </Button>
            )}
          </span>
        ))}

        <button
          type="button"
          aria-label="Choose roles"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((previous) => !previous)}
          className="flex min-w-[140px] flex-1 items-center justify-between gap-2 text-left text-base text-text-tertiary disabled:cursor-not-allowed md:text-[18px]"
        >
          {noneSelected
            ? "Choose for specific roles (e.g. 'Nurse', 'HR')..."
            : 'Add another role...'}
          <ChevronDown className="size-5 shrink-0 text-text-muted" aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div
          role="group"
          aria-label="Assignable roles"
          className="absolute left-0 top-full z-50 mt-1 max-h-[420px] w-full overflow-y-auto rounded-[12px] border border-border bg-background py-2 shadow-lg"
        >
          <RoleOption
            id="role-target-none"
            label="None"
            checked={noneSelected}
            disabled={busy || (!noneSelected && !canRemove)}
            onCheckedChange={(checked) => {
              if (checked) selectNone();
            }}
          />

          <GroupHeading>EVERYONE</GroupHeading>
          <RoleOption
            id="role-target-group-workers"
            label="Workers / Learners"
            checked={isGroupSelected(WORKER_ROLES)}
            disabled={busy || (isGroupSelected(WORKER_ROLES) ? !canRemove : !canAdd)}
            onCheckedChange={(checked) =>
              toggleGroup(WORKER_ROLES, 'every worker / learner role', checked)
            }
          />
          <RoleOption
            id="role-target-group-managers"
            label="Managers"
            checked={isGroupSelected(MANAGER_ROLES)}
            disabled={busy || (isGroupSelected(MANAGER_ROLES) ? !canRemove : !canAdd)}
            onCheckedChange={(checked) => toggleGroup(MANAGER_ROLES, 'every manager role', checked)}
          />

          <GroupHeading>MANAGERS</GroupHeading>
          {MANAGER_ROLES.map((role) => (
            <RoleOption
              key={role}
              id={`role-target-${role}`}
              label={getRoleDisplayName(role)}
              checked={selectedRoles.includes(role)}
              disabled={busy || (selectedRoles.includes(role) ? !canRemove : !canAdd)}
              onCheckedChange={(checked) => toggleRole(role, checked)}
            />
          ))}

          <GroupHeading>WORKERS / LEARNERS</GroupHeading>
          {WORKER_ROLES.map((role) => (
            <RoleOption
              key={role}
              id={`role-target-${role}`}
              label={getRoleDisplayName(role)}
              checked={selectedRoles.includes(role)}
              disabled={busy || (selectedRoles.includes(role) ? !canRemove : !canAdd)}
              onCheckedChange={(checked) => toggleRole(role, checked)}
            />
          ))}
        </div>
      )}

      <p className="mt-2.5 text-sm font-medium text-text-muted">
        Choose one or more roles to assign this course.
        {holderTotal !== null && !noneSelected && (
          <>
            {' '}
            <span className="font-semibold text-foreground">
              {holderTotal} {holderTotal === 1 ? 'person' : 'people'}
            </span>{' '}
            currently {holderTotal === 1 ? 'holds' : 'hold'} the selected roles — plus anyone
            assigned one later.
          </>
        )}
      </p>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop enrolling new staff?</AlertDialogTitle>
            <AlertDialogDescription>
              Staff who gain {pendingRemoval?.label} will no longer be enrolled in this course. The{' '}
              {isLive ? mode.enrolledCount : 0} already enrolled keep the course, and you can still
              assign it to people directly.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Inside the dialog deliberately: Radix marks everything behind the
              overlay aria-hidden, so a refusal rendered on the page would be
              invisible exactly when it matters. */}
          {dialogError && <Alert variant="error">{dialogError}</Alert>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                // Keep the dialog open until the action resolves, so a failure
                // surfaces in the alert above rather than vanishing with it.
                event.preventDefault();
                confirmRemoval();
              }}
            >
              {isPending ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-1.5 text-xs font-semibold tracking-[0.6px] text-text-tertiary">
      {children}
    </p>
  );
}

function RoleOption({
  id,
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-3 px-4 py-2 text-base text-foreground transition-colors ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-background-secondary'
      }`}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="size-5 shrink-0"
      />
      {label}
    </label>
  );
}
