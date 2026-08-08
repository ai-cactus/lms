'use client';

import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { PlusCircle } from 'lucide-react';
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
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { SupervisorCombobox } from './SupervisorCombobox';
import {
  createFacility,
  getSupervisorOptions,
  type SupervisorOption,
} from '@/app/actions/organization';
import { logger } from '@/lib/logger';
import { FACILITY_TYPE_OPTIONS, OTHER_FACILITY_TYPE } from '@/lib/facility/facility-type-options';

interface AddFacilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the success copy once the facility (and any invite) is created. */
  onCreated: (message: string) => void;
}

interface AddFacilityFormValues {
  name: string;
  /** Canonical labels, plus the `OTHER_FACILITY_TYPE` sentinel when free text is in play. */
  types: string[];
  otherType: string;
  address: string;
  supervisorEmail: string;
}

const CONTROL_CLASS = 'h-14 rounded-[10px] px-4 text-[15px]';
const FIELD_CLASS = 'gap-2 [&>label]:text-sm [&>label]:text-foreground';
const TYPES_LABEL_ID = 'add-facility-types-label';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMPTY_FORM: AddFacilityFormValues = {
  name: '',
  types: [],
  otherType: '',
  address: '',
  supervisorEmail: '',
};

export default function AddFacilityModal({ isOpen, onClose, onCreated }: AddFacilityModalProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [supervisors, setSupervisors] = useState<SupervisorOption[]>([]);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddFacilityFormValues>({ defaultValues: EMPTY_FORM });

  const selectedTypes = useWatch({ control, name: 'types' });
  const isOtherType = selectedTypes.includes(OTHER_FACILITY_TYPE);

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
    reset(EMPTY_FORM);
    setSubmitError(null);
    onClose();
  };

  const onSubmit = async (values: AddFacilityFormValues) => {
    setSubmitError(null);

    const types = values.types
      .filter((type) => type !== OTHER_FACILITY_TYPE)
      .concat(isOtherType ? [values.otherType.trim()] : []);
    const supervisorEmail = values.supervisorEmail.trim();

    const result = await createFacility({
      name: values.name.trim(),
      types,
      address: values.address.trim() || undefined,
      supervisorEmail: supervisorEmail || undefined,
    });

    if (!result.success) {
      setSubmitError(result.error ?? 'Failed to create facility.');
      return;
    }

    // An existing supervisor is assigned outright; a stranger only gets an
    // invite, which is best-effort server-side — so the confirmation must say
    // which of the three actually happened rather than implying an invite went out.
    let message = 'Facility created.';
    if (supervisorEmail && result.supervisorAssigned) {
      message = `Facility created. We assigned ${supervisorEmail} to manage it.`;
    } else if (supervisorEmail) {
      message = result.supervisorInvited
        ? `Facility created. We invited ${supervisorEmail} to manage it.`
        : `Facility created, but the invite to ${supervisorEmail} could not be sent. Invite them from Staff Details.`;
    }

    reset(EMPTY_FORM);
    onCreated(message);
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
          <DialogTitle>Add a new facility</DialogTitle>
          <DialogDescription>It starts as its own isolated workspace.</DialogDescription>
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

            <Controller
              name="types"
              control={control}
              rules={{
                validate: (value) => value.length > 0 || 'Select at least one facility type',
              }}
              render={({ field }) => {
                const toggle = (option: string, checked: boolean) =>
                  field.onChange(
                    checked
                      ? [...field.value, option]
                      : field.value.filter((value) => value !== option),
                  );

                return (
                  <div
                    role="group"
                    aria-labelledby={TYPES_LABEL_ID}
                    className="flex flex-col gap-3"
                  >
                    <p
                      id={TYPES_LABEL_ID}
                      className="flex items-center gap-2 text-sm font-medium text-foreground"
                    >
                      Facility type
                      <span className="text-error" aria-hidden="true">
                        *
                      </span>
                    </p>

                    {/* Two columns halve the list height so the form fits common
                        laptop viewports without the list looking clipped —
                        mirrors the onboarding step-3 layout for these options. */}
                    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                      {FACILITY_TYPE_OPTIONS.map((option) => (
                        <label key={option} className="flex cursor-pointer items-center gap-3">
                          <Checkbox
                            className="size-5 rounded-[6px]"
                            checked={field.value.includes(option)}
                            onCheckedChange={(checked) => toggle(option, checked === true)}
                          />
                          <span className="min-w-0 text-base break-words text-foreground">
                            {option}
                          </span>
                        </label>
                      ))}

                      {isOtherType ? (
                        <div className="flex flex-col gap-1.5 sm:col-span-2">
                          <div className="flex items-center gap-3">
                            <Checkbox
                              className="size-5 rounded-[6px]"
                              checked
                              aria-label={OTHER_FACILITY_TYPE}
                              onCheckedChange={() => toggle(OTHER_FACILITY_TYPE, false)}
                            />
                            <Input
                              className="h-9 rounded-none border-0 border-b border-input px-0 text-base shadow-none focus-visible:border-primary focus-visible:ring-0"
                              placeholder="Describe the facility type"
                              aria-label="Other facility type"
                              aria-invalid={errors.otherType ? true : undefined}
                              {...register('otherType', {
                                validate: (value, formValues) =>
                                  !formValues.types.includes(OTHER_FACILITY_TYPE) ||
                                  value.trim().length > 0 ||
                                  'Describe the facility type',
                              })}
                            />
                          </div>
                          {errors.otherType?.message && (
                            <p className="pl-8 text-sm text-error">{errors.otherType.message}</p>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggle(OTHER_FACILITY_TYPE, true)}
                          className="flex cursor-pointer items-center gap-3 justify-self-start text-base text-primary sm:col-span-2"
                        >
                          <PlusCircle className="size-5 shrink-0" aria-hidden="true" />
                          {OTHER_FACILITY_TYPE}
                        </button>
                      )}
                    </div>

                    {errors.types?.message && (
                      <p className="text-sm text-error">{errors.types.message}</p>
                    )}
                  </div>
                );
              }}
            />

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
              helperText="They’ll be invited to manage this facility. Leave empty if you’ll manage it yourself."
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
              Create facility
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
