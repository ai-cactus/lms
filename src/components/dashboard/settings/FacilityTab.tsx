'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateFacility } from '@/app/actions/organization';
import { cn } from '@/lib/utils';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { FACILITY_TYPE_OPTIONS, OTHER_FACILITY_TYPE } from '@/lib/facility/facility-type-options';
import type { Role } from '@/types/next-auth';
import AddFacilityModal from './AddFacilityModal';
import type { SettingsFacility } from './SettingsClient';

interface FacilityTabProps {
  facility: SettingsFacility | null;
  planName: string;
  viewerRole: Role;
}

interface FacilityFormValues {
  name: string;
  type: string;
}

const FACILITY_CONTROL_CLASS = 'h-12 rounded-xl border-[1.5px] border-[#e5e7ea] px-4 text-[15px]';
const FACILITY_FIELD_CLASS = 'gap-2 [&>label]:text-[13px] [&>label]:text-[#475367]';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function FacilityTab({ facility, planName, viewerRole }: FacilityTabProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAddFacility, setShowAddFacility] = useState(false);

  const canCreateFacility = can(dbRoleToRoleKey(viewerRole), 'facility.create');

  // A facility saved before this list existed (or via "Other") would otherwise
  // render as an empty select — keep its stored value selectable.
  const typeOptions = useMemo(() => {
    const options: string[] = [...FACILITY_TYPE_OPTIONS, OTHER_FACILITY_TYPE];
    const stored = facility?.type;
    return stored && !options.includes(stored) ? [...options, stored] : options;
  }, [facility?.type]);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FacilityFormValues>({
    defaultValues: { name: facility?.name ?? '', type: facility?.type ?? '' },
  });

  const header = (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-[#101928]">Facility profile</h2>
        <p className="text-sm text-[#667085]">
          Update the active facility&apos;s name and type. These appear across the workspace and in
          the facility switcher.
        </p>
      </div>
      {canCreateFacility && (
        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-2 rounded-xl border-[#e4e7ec] font-semibold text-primary hover:text-primary"
          onClick={() => setShowAddFacility(true)}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add Facility
        </Button>
      )}
    </div>
  );

  const addFacilityModal = canCreateFacility && (
    <AddFacilityModal
      isOpen={showAddFacility}
      onClose={() => setShowAddFacility(false)}
      onCreated={(text) => {
        setShowAddFacility(false);
        setMessage({ type: 'success', text });
        router.refresh();
      }}
    />
  );

  if (!facility) {
    return (
      <div className="flex flex-col">
        {header}
        {message && <Alert variant={message.type}>{message.text}</Alert>}
        <div className="mt-3 rounded-2xl border border-[#eceef2] bg-background p-6 text-sm text-[#667085]">
          No facility is attached to this organization yet.
        </div>
        {addFacilityModal}
      </div>
    );
  }

  const onSubmit = async (values: FacilityFormValues) => {
    setMessage(null);
    const result = await updateFacility({
      name: values.name.trim(),
      type: values.type || undefined,
    });

    if (result.success) {
      setMessage({ type: 'success', text: 'Facility updated.' });
      reset(values);
      router.refresh();
    } else {
      setMessage({ type: 'error', text: result.error ?? 'Failed to update facility.' });
    }
  };

  return (
    <div className="flex flex-col">
      {header}

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-5 rounded-2xl border border-[#eceef2] bg-background p-6"
      >
        <div className="flex items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#e0e7ff] text-lg font-bold text-[#4338ca]">
            {initials(facility.name)}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] font-bold tracking-[0.66px] text-[#98a2b3] uppercase">
              Active facility
            </span>
            <span className="truncate text-base font-semibold text-[#101928]">{facility.name}</span>
          </div>
        </div>

        <div className="h-px w-full bg-[#f0f2f5]" />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Facility name"
            required
            error={errors.name?.message}
            className={FACILITY_FIELD_CLASS}
          >
            <Input
              className={FACILITY_CONTROL_CLASS}
              placeholder="Enter facility name"
              {...register('name', { required: 'Facility name is required' })}
            />
          </Field>

          <Field label="Facility type" className={FACILITY_FIELD_CLASS}>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger
                    className={cn(FACILITY_CONTROL_CLASS, 'w-full justify-between [&_svg]:size-5')}
                  >
                    <SelectValue placeholder="Select facility type" />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#f9fafb] px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[#475367]">Subscription plan</span>
            <span className="text-[15px] font-semibold text-[#101928]">
              {planName || 'No active plan'}
            </span>
          </div>
          <Link href="/dashboard/billing" className="text-sm font-semibold text-primary">
            Manage in Billing
          </Link>
        </div>

        {message && <Alert variant={message.type}>{message.text}</Alert>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            type="button"
            className="rounded-xl border-[#e4e7ec] font-semibold text-[#475367]"
            onClick={() => {
              reset();
              setMessage(null);
            }}
            disabled={!isDirty || isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="rounded-xl font-semibold"
            loading={isSubmitting}
            disabled={!isDirty}
          >
            Save changes
          </Button>
        </div>
      </form>

      {addFacilityModal}
    </div>
  );
}
