'use client';

import { useEffect, useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { SupervisorCombobox } from './SupervisorCombobox';
import {
  createFacility,
  getSupervisorOptions,
  updateFacility,
  type SupervisorOption,
} from '@/app/actions/organization';
import { logger } from '@/lib/logger';
import { OTHER_FACILITY_TYPE } from '@/lib/facility/facility-type-options';
import {
  FacilityTypeMultiSelect,
  facilityTypeChips,
  facilityTypeList,
  joinFacilityTypes,
  parseFacilityTypes,
  type FacilityTypeValue,
} from './FacilityTypeMultiSelect';

/** The facility being edited — omit to put the modal in create mode. */
export interface EditableFacility {
  id: string;
  name: string;
  type: string | null;
  address: string | null;
  supervisorEmail: string | null;
}

interface AddFacilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, the modal updates this facility instead of creating a new one. */
  facility?: EditableFacility | null;
  /** Called with the success copy once the facility (and any invite) is saved. */
  onSaved: (message: string) => void;
}

interface FacilityFormValues {
  name: string;
  facilityTypes: FacilityTypeValue;
  address: string;
  supervisorEmail: string;
}

const CONTROL_CLASS = 'h-14 rounded-[10px] px-4 text-[15px]';
const FIELD_CLASS = 'gap-2 [&>label]:text-sm [&>label]:text-foreground';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMPTY_FORM: FacilityFormValues = {
  name: '',
  facilityTypes: { types: [], otherText: '' },
  address: '',
  supervisorEmail: '',
};

function formValuesFor(facility: EditableFacility | null | undefined): FacilityFormValues {
  if (!facility) return EMPTY_FORM;
  return {
    name: facility.name,
    facilityTypes: parseFacilityTypes(facility.type),
    address: facility.address ?? '',
    supervisorEmail: facility.supervisorEmail ?? '',
  };
}

/**
 * The success copy has to say which of the three supervisor outcomes actually
 * happened: an existing member is assigned outright, a stranger only gets an
 * invite, and that invite is best-effort server-side.
 */
function supervisorOutcomeMessage(
  base: string,
  supervisorEmail: string,
  result: { supervisorAssigned?: boolean; supervisorInvited?: boolean },
): string {
  if (!supervisorEmail) return base;
  if (result.supervisorAssigned) return `${base} We assigned ${supervisorEmail} to manage it.`;
  if (result.supervisorInvited) return `${base} We invited ${supervisorEmail} to manage it.`;
  return `${base.slice(0, -1)}, but the invite to ${supervisorEmail} could not be sent. Invite them from Staff Details.`;
}

export default function AddFacilityModal({
  isOpen,
  onClose,
  facility,
  onSaved,
}: AddFacilityModalProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [supervisors, setSupervisors] = useState<SupervisorOption[]>([]);
  const typesFieldId = useId();
  const typesErrorId = useId();

  const isUpdate = Boolean(facility);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FacilityFormValues>({ defaultValues: formValuesFor(facility) });

  const selectedTypes = useWatch({ control, name: 'facilityTypes' });
  const selectedCount = facilityTypeChips(selectedTypes).length;

  // Re-seed whenever a different facility is opened — the form is mounted once
  // and reused across every card's Edit link.
  useEffect(() => {
    if (isOpen) reset(formValuesFor(facility));
  }, [isOpen, facility, reset]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    getSupervisorOptions()
      .then((result) => {
        if (active) setSupervisors(result.options);
      })
      .catch((error) => {
        // Non-fatal: the field still works as free-text email entry.
        logger.error({ msg: '[org] Failed to load supervisor options', err: error });
      });

    return () => {
      active = false;
    };
  }, [isOpen]);

  const close = () => {
    reset(formValuesFor(facility));
    setSubmitError(null);
    onClose();
  };

  const onSubmit = async (values: FacilityFormValues) => {
    setSubmitError(null);

    const supervisorEmail = values.supervisorEmail.trim();
    const name = values.name.trim();
    const address = values.address.trim() || undefined;

    if (facility) {
      // Re-sending the unchanged supervisor would re-upsert the assignment and
      // report it as a fresh hand-over, so only a real change is submitted.
      const changedSupervisor =
        supervisorEmail.toLowerCase() === (facility.supervisorEmail ?? '').trim().toLowerCase()
          ? ''
          : supervisorEmail;

      const result = await updateFacility({
        facilityId: facility.id,
        name,
        type: joinFacilityTypes(values.facilityTypes) || undefined,
        address,
        supervisorEmail: changedSupervisor || undefined,
      });

      if (!result.success) {
        setSubmitError(result.error ?? 'Failed to update facility.');
        return;
      }

      onSaved(supervisorOutcomeMessage('Facility updated.', changedSupervisor, result));
      return;
    }

    const result = await createFacility({
      name,
      types: facilityTypeList(values.facilityTypes),
      address,
      supervisorEmail: supervisorEmail || undefined,
    });

    if (!result.success) {
      setSubmitError(result.error ?? 'Failed to create facility.');
      return;
    }

    reset(EMPTY_FORM);
    onSaved(supervisorOutcomeMessage('Facility created.', supervisorEmail, result));
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {/* Header and footer stay pinned; only the form body scrolls. A single
          scrolling DialogContent hides the footer below the fold on short
          viewports, which reads as the type list overflowing the modal. */}
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[640px]">
        <DialogHeader className="gap-1">
          <DialogTitle>{isUpdate ? 'Update facility' : 'Add a new facility'}</DialogTitle>
          <DialogDescription>Set up a facility and choose who will manage it.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col gap-6">
          {/* The global scrollbar style is invisible until hover, which made the
              scrollable body read as clipped content — force a visible thumb. */}
          <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain pr-2 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:bg-border">
            <Field
              label="Facility name"
              required
              error={errors.name?.message}
              className={FIELD_CLASS}
            >
              <Input
                className={CONTROL_CLASS}
                placeholder="e.g. Sunrise Behavioral Health"
                {...register('name', { required: 'Facility name is required' })}
              />
            </Field>

            {/* Not a `Field`: the label row carries a selection-count badge, and
                `Field` renders a plain string label. */}
            <div className="flex w-full flex-col gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={typesFieldId}>
                  Facility type
                  <span className="text-error" aria-hidden="true">
                    *
                  </span>
                </Label>
                {selectedCount > 0 && (
                  <Badge className="bg-primary/10 text-primary">{selectedCount} selected</Badge>
                )}
              </div>

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
                    className={CONTROL_CLASS}
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

            <Field label="Facility Address" className={FIELD_CLASS}>
              <Input
                className={CONTROL_CLASS}
                placeholder="Add facility address"
                {...register('address')}
              />
            </Field>

            <Field
              label="Supervisor"
              error={errors.supervisorEmail?.message}
              helperText={
                isUpdate
                  ? undefined
                  : 'They’ll be invited to manage this facility. Leave empty if you’ll manage it yourself.'
              }
              className={FIELD_CLASS}
            >
              <Controller
                name="supervisorEmail"
                control={control}
                rules={{
                  // Blank is valid — "leave empty if you'll manage it yourself".
                  validate: (value) =>
                    !value.trim() ||
                    EMAIL_PATTERN.test(value.trim()) ||
                    'Enter a valid supervisor email',
                }}
                render={({ field }) => (
                  <SupervisorCombobox
                    options={supervisors}
                    className={CONTROL_CLASS}
                    placeholder="e.g. supervisor@yourfacility.com"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </Field>

            {submitError && <Alert variant="error">{submitError}</Alert>}
          </div>

          <DialogFooter className="gap-3 sm:grid sm:grid-cols-2">
            <Button variant="outline" type="button" onClick={close} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" className="font-semibold" loading={isSubmitting}>
              {isUpdate ? 'Update facility' : 'Create facility'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
