import React from 'react';
import { Building2 } from 'lucide-react';

/** Shared header-cell chrome for both Global View tables. */
// whitespace-normal: long metric headers ("Training Completion %") must be able
// to wrap — nowrap headers set a hard min-width per column, and together they
// can exceed the container, forcing the whole table to scroll sideways.
export const facilityTableHeadClass =
  'h-10 bg-background-secondary px-4 text-xs font-medium whitespace-normal text-text-secondary';

interface TableSectionProps {
  title: string;
  description: string;
  /** Rendered as "Showing 1 to {shown} of {total} facilities". */
  shown: number;
  total: number;
  /** In comparison mode the footer counts the selected facilities instead. */
  comparing?: boolean;
  children: React.ReactNode;
}

/**
 * Card chrome shared by the Priority Risks and Facilities Overview tables —
 * heading block, the table itself, and the row-count footer.
 */
export function FacilityTableSection({
  title,
  description,
  shown,
  total,
  comparing = false,
  children,
}: TableSectionProps) {
  return (
    // @container: column visibility inside is driven by THIS card's width, not
    // the viewport — with the sidebar open the two differ by ~300px.
    <section className="@container flex flex-col gap-5 rounded-[17px] border border-border bg-background p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground md:text-xl">{title}</h2>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
      {children}
      {total > 0 && (
        <p className="text-sm text-text-secondary">
          {comparing
            ? `Showing ${shown} of ${total} selected ${total === 1 ? 'facility' : 'facilities'}`
            : `Showing 1 to ${shown} of ${total} ${total === 1 ? 'facility' : 'facilities'}`}
        </p>
      )}
    </section>
  );
}

/** Subtitle both Global View tables use while a subset of facilities is compared. */
export function facilityComparisonDescription(selectedCount: number, totalCount: number): string {
  return `Comparing ${selectedCount} of ${totalCount} ${totalCount === 1 ? 'facility' : 'facilities'}`;
}

export function FacilityNameCell({ name, type }: { name: string; type: string | null }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-background-secondary text-text-secondary"
      >
        <Building2 className="size-[18px]" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold text-foreground" title={name}>
          {name}
        </span>
        {type && (
          <span className="truncate text-xs text-text-secondary" title={type}>
            {type}
          </span>
        )}
      </div>
    </div>
  );
}
