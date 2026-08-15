import Link from 'next/link';
import { ContactRound, Info, Mail, MapPin } from 'lucide-react';
import { DetailRow, EM_DASH, facilityInitials } from './ui';
import type { FacilityCardData } from './types';

interface MyFacilitiesSectionProps {
  facilities: FacilityCardData[];
}

export default function MyFacilitiesSection({ facilities }: MyFacilitiesSectionProps) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-foreground">My facilities</h2>

      <div
        role="note"
        className="flex items-start gap-3 rounded-[10px] border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
      >
        <Info className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <p>
          You can edit facility details in{' '}
          <Link href="/dashboard/settings" className="font-semibold text-foreground underline">
            settings.
          </Link>{' '}
          Facility details can also be updated by facility supervisor.
        </p>
      </div>

      {facilities.length === 0 ? (
        <div className="rounded-2xl border border-border bg-background p-6 text-sm text-text-secondary">
          No facility is attached to this organization yet.
        </div>
      ) : (
        facilities.map((facility) => (
          <article
            key={facility.id}
            className="flex flex-col gap-5 rounded-2xl border border-border bg-background p-6"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
              <div className="flex size-[72px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                {facilityInitials(facility.name)}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h3 className="text-base font-semibold break-words text-foreground">
                  {facility.name}
                </h3>
                <p className="text-sm text-text-secondary">Facility type:</p>
                <p className="text-sm break-words text-foreground">{facility.type || EM_DASH}</p>
              </div>

              <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                In operation
              </span>
            </div>

            <div className="h-px w-full bg-border" />

            <div className="flex flex-col gap-3">
              <DetailRow
                icon={ContactRound}
                label="Facility Supervisor"
                value={facility.supervisorName}
              />
              <DetailRow icon={Mail} label="Email" value={facility.supervisorEmail} />
              <DetailRow icon={MapPin} label="Address" value={facility.address} />
            </div>
          </article>
        ))
      )}
    </div>
  );
}
