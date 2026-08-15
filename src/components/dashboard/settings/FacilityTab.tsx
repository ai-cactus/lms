'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ContactRound, Mail, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';
import AddFacilityModal from './AddFacilityModal';
import type { SettingsFacility } from './SettingsClient';

interface FacilityTabProps {
  facilities: SettingsFacility[];
  viewerRole: Role;
}

const EM_DASH = '—';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="w-32 shrink-0 text-text-secondary sm:w-40">{label}</span>
      <span className="shrink-0 text-text-secondary">:</span>
      <span className="min-w-0 truncate text-foreground">{value}</span>
    </div>
  );
}

export default function FacilityTab({ facilities, viewerRole }: FacilityTabProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAddFacility, setShowAddFacility] = useState(false);
  const [editingFacility, setEditingFacility] = useState<SettingsFacility | null>(null);

  const roleKey = dbRoleToRoleKey(viewerRole);
  const canCreateFacility = can(roleKey, 'facility.create');
  const canEditFacility = can(roleKey, 'facility.edit');

  const onSaved = (text: string) => {
    setShowAddFacility(false);
    setEditingFacility(null);
    setMessage({ type: 'success', text });
    router.refresh();
  };

  return (
    <div className="flex flex-col">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Facility profile</h2>
          <p className="text-sm text-text-secondary">
            Update the active facility&apos;s name and type. These appear across the workspace and
            in the facility switcher.
          </p>
        </div>
        {canCreateFacility && (
          <Button
            type="button"
            className="shrink-0 gap-2 rounded-xl font-semibold"
            onClick={() => setShowAddFacility(true)}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add Facility
          </Button>
        )}
      </div>

      {message && (
        <Alert variant={message.type} className="mb-4">
          {message.text}
        </Alert>
      )}

      {facilities.length === 0 ? (
        <div className="rounded-2xl border border-border bg-background p-6 text-sm text-text-secondary">
          No facility is attached to this organization yet.
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {facilities.map((facility) => (
            <article
              key={facility.id}
              className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex size-[60px] shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
                  {initials(facility.name)}
                </div>
                {canEditFacility && (
                  <button
                    type="button"
                    onClick={() => setEditingFacility(facility)}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-sm font-medium text-primary"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    Edit
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-foreground">{facility.name}</h3>
                <p className="text-sm text-text-secondary">
                  Facility type: {facility.type || EM_DASH}
                </p>
              </div>

              <div className="h-px w-full bg-border" />

              <div className="flex flex-col gap-3">
                <DetailRow
                  icon={ContactRound}
                  label="Facility Supervisor"
                  value={facility.supervisorName || EM_DASH}
                />
                <DetailRow icon={Mail} label="Email" value={facility.supervisorEmail || EM_DASH} />
              </div>
            </article>
          ))}
        </div>
      )}

      {/* One mounted instance covers both modes — `facility` decides whether it
          creates or updates, so every card's Edit link reuses the same form. */}
      {(canCreateFacility || canEditFacility) && (
        <AddFacilityModal
          isOpen={showAddFacility || editingFacility !== null}
          facility={editingFacility}
          onClose={() => {
            setShowAddFacility(false);
            setEditingFacility(null);
          }}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
