'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AccessibleFacility } from '@/lib/facility/scope';

/** Sentinel for the org-wide option — `Select` cannot carry an empty value. */
const ALL_FACILITIES = 'all';

/** Query parameter that carries the view's facility scope. */
export const FACILITY_SCOPE_PARAM = 'facility';

interface FacilityScopeSwitcherProps {
  facilities: AccessibleFacility[];
  /** Currently scoped facility, or null for "All Facilities". */
  selectedFacilityId: string | null;
}

/**
 * Scope selector for the dashboard header. Facility scope is URL state, never a
 * session claim — switching rewrites `?facility=` on the current path so the
 * view is shareable, bookmarkable and re-authorised on every request.
 */
export default function FacilityScopeSwitcher({
  facilities,
  selectedFacilityId,
}: FacilityScopeSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === ALL_FACILITIES) {
      params.delete(FACILITY_SCOPE_PARAM);
    } else {
      params.set(FACILITY_SCOPE_PARAM, value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <Select value={selectedFacilityId ?? ALL_FACILITIES} onValueChange={handleChange}>
      <SelectTrigger
        aria-label="Facility scope"
        className="h-10 min-w-[170px] rounded-[8px] border-border bg-background text-sm font-medium text-foreground"
      >
        <SelectValue placeholder="All Facilities" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_FACILITIES}>All Facilities</SelectItem>
        {facilities.map((facility) => (
          <SelectItem key={facility.id} value={facility.id}>
            {facility.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
