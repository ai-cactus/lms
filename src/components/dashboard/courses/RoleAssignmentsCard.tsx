'use client';

import { useState, useTransition } from 'react';
import { Users2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { revokeRoleAssignment, type RoleAssignmentRow } from '@/app/actions/enrollment';
import { getRoleDisplayName } from '@/lib/rbac/role-utils';
import { logger } from '@/lib/logger';
import type { Role } from '@/types/next-auth';

interface Props {
  assignments: RoleAssignmentRow[];
  /** The viewer holds `assignment.delete`. Read-only viewers still see the list. */
  canRevoke: boolean;
}

const REVOKE_FALLBACK = 'We could not revoke that assignment. Please try again.';

/**
 * The org's live role-target assignments — the reason a brand-new staff account
 * can arrive already enrolled in courses.
 *
 * A course published with role targets keeps enrolling everyone who GAINS one of
 * those roles afterwards. That was previously invisible and irreversible in-app:
 * nothing listed these rows and nothing could switch one off, so an admin had no
 * way to see why a new joiner picked up courses.
 */
export default function RoleAssignmentsCard({ assignments, canRevoke }: Props) {
  const [pendingRevoke, setPendingRevoke] = useState<RoleAssignmentRow | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleRevoke = () => {
    if (!pendingRevoke) return;
    const { id, courseTitle } = pendingRevoke;
    setError('');

    startTransition(async () => {
      try {
        const result = await revokeRoleAssignment(id);
        if (!result.success) {
          setError(result.error ?? REVOKE_FALLBACK);
          return;
        }
        setPendingRevoke(null);
      } catch (err) {
        logger.error({ msg: '[assignment] Revoke failed', err, assignmentId: id, courseTitle });
        setError(REVOKE_FALLBACK);
      }
    });
  };

  if (assignments.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-white p-5">
        <h2 className="text-base font-semibold text-foreground">Automatic role assignments</h2>
        <p className="mt-1 text-sm text-text-secondary">
          No course is set to enrol staff automatically. New staff start with nothing assigned.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-white p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Automatic role assignments</h2>
        <p className="text-sm text-text-secondary">
          These courses enrol every staff member who holds the listed role — including anyone who
          joins or changes to it later. Revoking stops future staff being enrolled; people already
          enrolled keep their course.
        </p>
      </div>

      <ul className="mt-4 flex flex-col divide-y divide-border">
        {assignments.map((assignment) => (
          <li
            key={assignment.id}
            className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">
                {assignment.courseTitle}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {assignment.targetRoles.map((role) => (
                  <Badge key={role} variant="secondary" className="text-xs font-medium">
                    {getRoleDisplayName(role as Role)}
                  </Badge>
                ))}
                {assignment.facilityScoped && (
                  <span className="inline-flex items-center gap-1 text-xs text-text-tertiary">
                    <Building2 className="size-3.5" aria-hidden="true" />
                    Limited to selected facilities
                  </span>
                )}
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-text-tertiary">
                <Users2 className="size-3.5" aria-hidden="true" />
                {assignment.enrolledCount} enrolled so far
                {assignment.dueWindowDays
                  ? ` · due ${assignment.dueWindowDays} days after joining the role`
                  : ''}
              </span>
            </div>

            {canRevoke && (
              <Button
                variant="outline"
                className="shrink-0"
                disabled={isPending}
                onClick={() => {
                  setError('');
                  setPendingRevoke(assignment);
                }}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>

      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop enrolling new staff?</AlertDialogTitle>
            <AlertDialogDescription>
              Staff who gain a targeted role will no longer be enrolled in{' '}
              {pendingRevoke?.courseTitle}. The {pendingRevoke?.enrolledCount ?? 0} already enrolled
              keep the course, and you can still assign it to people directly.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Inside the dialog deliberately: Radix marks everything behind the
              overlay aria-hidden, so a refusal rendered on the card would be
              invisible exactly when it matters. */}
          {error && <Alert variant="error">{error}</Alert>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                // Keep the dialog open until the action resolves, so a failure
                // surfaces in the alert above rather than vanishing with it.
                event.preventDefault();
                handleRevoke();
              }}
            >
              {isPending ? 'Revoking…' : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
