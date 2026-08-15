'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { MapPin, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Field } from '@/components/ui';
import { updateFacility } from '@/app/actions/organization';
import {
  FacilityTypeMultiSelect,
  facilityTypeChips,
  joinFacilityTypes,
  parseFacilityTypes,
  type FacilityTypeValue,
} from '../settings/FacilityTypeMultiSelect';
import { OTHER_FACILITY_TYPE } from '@/lib/facility/facility-type-options';
import { DetailRow, EM_DASH, facilityInitials } from './ui';
import type { FacilityCardData } from './types';

interface AssignedFacilitiesSectionProps {
  facilities: FacilityCardData[];
}

interface FacilityFormValues {
  name: string;
  facilityTypes: FacilityTypeValue;
  address: string;
}

function toFormValues(facility: FacilityCardData): FacilityFormValues {
  return {
    name: facility.name,
    facilityTypes: parseFacilityTypes(facility.type),
    address: facility.address ?? '',
  };
}

export default function AssignedFacilitiesSection({ facilities }: AssignedFacilitiesSectionProps) {
  const router = useRouter();
  const typesFieldId = useId();
  const typesErrorId = useId();

  const [editing, setEditing] = useState<FacilityCardData | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FacilityFormValues>({
    defaultValues: { name: '', facilityTypes: { types: [], otherText: '' }, address: '' },
  });

  useEffect(() => {
    if (editing) reset(toFormValues(editing));
  }, [editing, reset]);

  const onSubmit = async (values: FacilityFormValues) => {
    if (!editing) return;
    setMessage(null);

    // A supervisor never reassigns the facility, so `supervisorEmail` is
    // deliberately absent — the server rejects it for this role anyway.
    const result = await updateFacility({
      facilityId: editing.id,
      name: values.name.trim(),
      type: joinFacilityTypes(values.facilityTypes) || undefined,
      address: values.address.trim() || undefined,
    });

    if (!result.success) {
      setMessage({ type: 'error', text: result.error ?? 'Failed to update facility.' });
      return;
    }

    setMessage({ type: 'success', text: 'Facility updated.' });
    setEditing(null);
    router.refresh();
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-foreground">My facilities</h2>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setEditing(null);
                setMessage(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="assigned-facility-form" loading={isSubmitting}>
              Save
            </Button>
          </div>
        </div>

        {message && <Alert variant={message.type}>{message.text}</Alert>}

        <form
          id="assigned-facility-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          {/* PROF-003: the facility's own name leads the form — it used to sit
              below the type picker, which read as editing an unnamed record. */}
          <Field label="Facility name" required error={errors.name?.message}>
            <Input
              placeholder="e.g. Sunrise Behavioral Health"
              {...register('name', { required: 'Facility name is required' })}
            />
          </Field>

          <div className="flex w-full flex-col gap-1.5">
            <Label htmlFor={typesFieldId}>Facility type</Label>
            <Controller
              name="facilityTypes"
              control={control}
              rules={{
                validate: (value) => {
                  if (facilityTypeChips(value).length === 0) {
                    return 'Select at least one facility type';
                  }
                  return (
                    !value.types.includes(OTHER_FACILITY_TYPE) ||
                    value.otherText.trim().length > 0 ||
                    'Describe the facility type'
                  );
                },
              }}
              render={({ field }) => (
                <FacilityTypeMultiSelect
                  id={typesFieldId}
                  value={field.value}
                  onChange={field.onChange}
                  className="h-14"
                  placeholder="Add another type..."
                  aria-describedby={errors.facilityTypes ? typesErrorId : undefined}
                />
              )}
            />
            {errors.facilityTypes?.message && (
              <p id={typesErrorId} className="text-sm text-error">
                {errors.facilityTypes.message}
              </p>
            )}
          </div>

          <Field label="Facility Address">
            <Input placeholder="Add facility address" {...register('address')} />
          </Field>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-foreground">Assigned facilities</h2>

      {message && <Alert variant={message.type}>{message.text}</Alert>}

      {facilities.length === 0 ? (
        <div className="rounded-2xl border border-border bg-background p-6 text-sm text-text-secondary">
          You are not assigned to any facility yet.
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

              <Button
                variant="outline"
                type="button"
                className="w-fit shrink-0 gap-2"
                onClick={() => {
                  setMessage(null);
                  setEditing(facility);
                }}
              >
                Edit
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="h-px w-full bg-border" />

            <DetailRow icon={MapPin} label="Address" value={facility.address} />
          </article>
        ))
      )}
    </div>
  );
}
