'use client';

import { useState } from 'react';
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
import { Alert } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { createFacility } from '@/app/actions/organization';
import { FACILITY_TYPE_OPTIONS, OTHER_FACILITY_TYPE } from '@/lib/facility/facility-type-options';

interface AddFacilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the success copy once the facility (and any invite) is created. */
  onCreated: (message: string) => void;
}

interface AddFacilityFormValues {
  name: string;
  type: string;
  otherType: string;
  address: string;
  supervisorEmail: string;
}

const CONTROL_CLASS = 'h-12 rounded-xl border-[1.5px] border-border px-4 text-[15px]';
const FIELD_CLASS = 'gap-2 [&>label]:text-[13px] [&>label]:text-text-secondary';

const EMPTY_FORM: AddFacilityFormValues = {
  name: '',
  type: '',
  otherType: '',
  address: '',
  supervisorEmail: '',
};

export default function AddFacilityModal({ isOpen, onClose, onCreated }: AddFacilityModalProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddFacilityFormValues>({ defaultValues: EMPTY_FORM });

  const selectedType = useWatch({ control, name: 'type' });
  const isOtherType = selectedType === OTHER_FACILITY_TYPE;

  const close = () => {
    reset(EMPTY_FORM);
    setSubmitError(null);
    onClose();
  };

  const onSubmit = async (values: AddFacilityFormValues) => {
    setSubmitError(null);

    const type = isOtherType ? values.otherType.trim() : values.type;
    const supervisorEmail = values.supervisorEmail.trim();

    const result = await createFacility({
      name: values.name.trim(),
      type,
      address: values.address.trim() || undefined,
      supervisorEmail: supervisorEmail || undefined,
    });

    if (!result.success) {
      setSubmitError(result.error ?? 'Failed to create facility.');
      return;
    }

    // The supervisor invite is best-effort server-side, so the confirmation must
    // tell the admin whether it actually went out rather than implying it did.
    const message = supervisorEmail
      ? result.supervisorInvited
        ? `Facility created. We invited ${supervisorEmail} to manage it.`
        : `Facility created, but the invite to ${supervisorEmail} could not be sent. Invite them from Staff Details.`
      : 'Facility created.';

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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add facility</DialogTitle>
          <DialogDescription>It starts as its own isolated workspace.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <Field
            label="Facility name"
            required
            error={errors.name?.message}
            className={FIELD_CLASS}
          >
            <Input
              className={CONTROL_CLASS}
              placeholder="Enter facility name"
              {...register('name', { required: 'Facility name is required' })}
            />
          </Field>

          <Field
            label="Facility type"
            required
            error={errors.type?.message}
            className={FIELD_CLASS}
          >
            <Controller
              name="type"
              control={control}
              rules={{ required: 'Select a facility type' }}
              render={({ field }) => (
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  aria-label="Facility type"
                  className="gap-2 rounded-xl border border-border p-3"
                >
                  {[...FACILITY_TYPE_OPTIONS, OTHER_FACILITY_TYPE].map((option) => (
                    <label
                      key={option}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-accent"
                    >
                      <RadioGroupItem value={option} className="mt-0.5" />
                      <span>{option}</span>
                    </label>
                  ))}
                </RadioGroup>
              )}
            />
          </Field>

          {isOtherType && (
            <Field
              label="Specify facility type"
              required
              error={errors.otherType?.message}
              className={FIELD_CLASS}
            >
              <Input
                className={CONTROL_CLASS}
                placeholder="Describe the facility type"
                {...register('otherType', {
                  validate: (value, formValues) =>
                    formValues.type !== OTHER_FACILITY_TYPE ||
                    value.trim().length > 0 ||
                    'Describe the facility type',
                })}
              />
            </Field>
          )}

          <Field label="Facility address" className={FIELD_CLASS}>
            <Input
              className={CONTROL_CLASS}
              placeholder="Street, city, state"
              {...register('address')}
            />
          </Field>

          <Field
            label="Supervisor"
            error={errors.supervisorEmail?.message}
            helperText="They’ll be invited to manage this facility. Leave empty if you’ll manage it yourself."
            className={FIELD_CLASS}
          >
            <Input
              className={CONTROL_CLASS}
              type="email"
              placeholder="supervisor@example.com"
              {...register('supervisorEmail', {
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Enter a valid supervisor email',
                },
              })}
            />
          </Field>

          {submitError && <Alert variant="error">{submitError}</Alert>}

          <DialogFooter>
            <Button variant="ghost" type="button" onClick={close} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" className="rounded-xl font-semibold" loading={isSubmitting}>
              Create facility
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
