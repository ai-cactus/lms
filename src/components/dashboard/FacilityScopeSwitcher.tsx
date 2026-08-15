'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { FACILITY_SCOPE_PARAM, serializeFacilityScopeParam } from '@/lib/facility/scope-param';
import type { AccessibleFacility } from '@/lib/facility/scope';
import FacilityScopePalette from './FacilityScopePalette';

interface FacilityScopeSwitcherProps {
  facilities: AccessibleFacility[];
  /** Facilities in scope: none = all, one = drill-down, 2+ = comparison. */
  selectedFacilityIds: string[];
  /** Training Completion % per facility, surfaced on the palette's rows. */
  completionPercentByFacilityId?: Record<string, number>;
}

/** The current path with `?facility=` rewritten for `facilityIds` (empty = removed). */
export function buildFacilityScopeHref(
  pathname: string,
  currentQuery: string,
  facilityIds: string[],
): string {
  const params = new URLSearchParams(currentQuery);
  const value = serializeFacilityScopeParam(facilityIds);
  if (value) {
    params.set(FACILITY_SCOPE_PARAM, value);
  } else {
    params.delete(FACILITY_SCOPE_PARAM);
  }
  // A comma is a legal query sub-delimiter and keeps a shared comparison link
  // readable, so undo URLSearchParams' percent-encoding of it.
  const query = params.toString().replace(/%2C/g, ',');
  return query ? `${pathname}?${query}` : pathname;
}

/** What the trigger reads for a given selection. */
export function facilityScopeLabel(
  facilities: AccessibleFacility[],
  selectedFacilityIds: string[],
): string {
  if (selectedFacilityIds.length === 0) return 'All Facilities';
  if (selectedFacilityIds.length === 1) {
    const facility = facilities.find((candidate) => candidate.id === selectedFacilityIds[0]);
    return facility?.name ?? '1 facility selected';
  }
  return `${selectedFacilityIds.length} facilities selected`;
}

/**
 * Scope control for the dashboard header. Facility scope is URL state, never a
 * session claim — applying a selection rewrites `?facility=` on the current path
 * so the view is shareable, bookmarkable and re-authorised on every request.
 */
export default function FacilityScopeSwitcher({
  facilities,
  selectedFacilityIds,
  completionPercentByFacilityId,
}: FacilityScopeSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);

  const label = facilityScopeLabel(facilities, selectedFacilityIds);

  const handleApply = (facilityIds: string[]) => {
    router.push(buildFacilityScopeHref(pathname, searchParams.toString(), facilityIds));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Facility scope: ${label}`}
        className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[8px] border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-background-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="max-w-[180px] truncate sm:max-w-[240px]">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      </button>

      <FacilityScopePalette
        open={open}
        onOpenChange={setOpen}
        facilities={facilities}
        selectedFacilityIds={selectedFacilityIds}
        completionPercentByFacilityId={completionPercentByFacilityId}
        onApply={handleApply}
      />
    </>
  );
}
