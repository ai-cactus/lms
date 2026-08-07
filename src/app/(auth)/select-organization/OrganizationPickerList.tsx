'use client';

import { useState, useTransition } from 'react';
import { Building2, Check, ChevronRight } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { switchOrganization } from '@/app/actions/session-bridge';
import { logger } from '@/lib/logger';

export interface OrganizationOption {
  organizationId: string;
  organizationName: string;
  roleLabel: string;
}

interface OrganizationPickerListProps {
  organizations: OrganizationOption[];
  activeOrganizationId: string | null;
}

export default function OrganizationPickerList({
  organizations,
  activeOrganizationId,
}: OrganizationPickerListProps) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (organizationId: string) => {
    setError(null);
    setPendingId(organizationId);
    startTransition(async () => {
      try {
        await switchOrganization(organizationId);
      } catch (err) {
        // A successful switch redirects, which throws a control-flow error that
        // must propagate untouched; anything else is a real failure.
        if (err && typeof err === 'object' && 'digest' in err) throw err;
        logger.error({ msg: '[org] Failed to switch organization', err });
        setPendingId(null);
        setError('We could not switch organizations. Please try again.');
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="error" className="w-full" title="Switch failed">
          {error}
        </Alert>
      )}

      <ul className="flex flex-col gap-3">
        {organizations.map((organization) => {
          const isActive = organization.organizationId === activeOrganizationId;
          const isLoading = pendingId === organization.organizationId;

          return (
            <li key={organization.organizationId}>
              <button
                type="button"
                onClick={() => handleSelect(organization.organizationId)}
                disabled={isPending}
                aria-busy={isLoading}
                className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-background-secondary px-4 py-4 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background text-primary">
                  <Building2 className="size-5" aria-hidden="true" />
                </span>

                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold leading-5 text-text-title font-text sm:text-base">
                    {organization.organizationName}
                  </span>
                  <span className="truncate text-xs leading-5 text-text-neutral font-text sm:text-sm">
                    {organization.roleLabel}
                  </span>
                </span>

                {isActive && (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success font-text">
                    <Check className="size-4" aria-hidden="true" />
                    Current
                  </span>
                )}

                <ChevronRight
                  className="size-5 shrink-0 text-text-neutral transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
