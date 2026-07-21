'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
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
import type { SettingsFacility } from './SettingsClient';

interface FacilityTabProps {
  facility: SettingsFacility | null;
  planName: string;
}

const FACILITY_TYPE_OPTIONS = [
  'Behavioral health',
  'Substance use disorder treatment',
  'Community mental health center',
  'Residential / inpatient',
  'Outpatient clinic',
  'School- or campus-based',
  'Other',
];

interface FacilityFormValues {
  name: string;
  type: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function FacilityTab({ facility, planName }: FacilityTabProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FacilityFormValues>({
    defaultValues: { name: facility?.name ?? '', type: facility?.type ?? '' },
  });

  if (!facility) {
    return (
      <div className="rounded-xl border border-border bg-background p-6 text-sm text-text-secondary">
        No facility is attached to this organization yet.
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
      <div className="mb-6 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Facility profile</h2>
        <p className="text-sm text-text-secondary">
          Update the active facility&apos;s name and type. These appear across the workspace and in
          the facility switcher.
        </p>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-6 rounded-xl border border-border bg-background p-6"
      >
        <div className="flex items-center gap-4 border-b border-border pb-6">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
            {initials(facility.name)}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
              Active facility
            </span>
            <span className="truncate text-base font-semibold text-foreground">
              {facility.name}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Facility name" required error={errors.name?.message}>
            <Input
              placeholder="Enter facility name"
              {...register('name', { required: 'Facility name is required' })}
            />
          </Field>

          <Field label="Facility type">
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger className="h-14 w-full">
                    <SelectValue placeholder="Select facility type" />
                  </SelectTrigger>
                  <SelectContent>
                    {FACILITY_TYPE_OPTIONS.map((option) => (
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

        <div className="flex items-center justify-between gap-3 rounded-lg bg-background-secondary px-4 py-3">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-text-secondary">Subscription plan</span>
            <span className="text-sm font-semibold text-foreground">
              {planName || 'No active plan'}
            </span>
          </div>
          <Link href="/dashboard/billing" className="text-sm font-semibold text-primary">
            Manage in Billing
          </Link>
        </div>

        {message && <Alert variant={message.type}>{message.text}</Alert>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              reset();
              setMessage(null);
            }}
            disabled={!isDirty || isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
