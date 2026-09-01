'use client';

import React, { useEffect } from 'react';
import { useForm, useController, useWatch, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Stepper from '@/components/onboarding/Stepper';
import { logger } from '@/lib/logger';
import { useOnboardingStep } from '@/lib/analytics/use-onboarding-step';
import {
  ADDITIONAL_BUSINESS_TYPES,
  OTHER_OPTION_ID,
  PRIMARY_BUSINESS_TYPES,
  PROGRAM_SERVICES,
  type OnboardingOption,
} from '@/lib/constants/onboarding-options';
import {
  hydrateSelection,
  hydrateSingleSelection,
  resolveSelection,
  resolveSingleSelection,
} from '@/lib/onboarding/step3-selection';

interface Step3FormData {
  primaryBusinessType: string;
  primaryBusinessTypeOtherText: string;
  additionalBusinessTypes: string[];
  additionalBusinessTypeOtherText: string;
  services: string[];
  servicesOtherText: string;
}

const BLANK_STEP3_VALUES: Step3FormData = {
  primaryBusinessType: '',
  primaryBusinessTypeOtherText: '',
  additionalBusinessTypes: [],
  additionalBusinessTypeOtherText: '',
  services: [],
  servicesOtherText: '',
};

interface PersistedStep3 {
  primaryBusinessType?: string;
  additionalBusinessTypes?: string[];
  services?: string[];
}

/**
 * "Other" is deliberately excluded from the known-id sets: a persisted value is
 * either a canonical id or the free text typed into the "Other" box, and free
 * text of literally "other" must rehydrate into the text box, not the option.
 */
function knownIdsOf(options: readonly OnboardingOption[]): ReadonlySet<string> {
  return new Set(options.filter((option) => option.id !== OTHER_OPTION_ID).map((o) => o.id));
}

const PRIMARY_BUSINESS_TYPE_IDS = knownIdsOf(PRIMARY_BUSINESS_TYPES);
const ADDITIONAL_BUSINESS_TYPE_IDS = knownIdsOf(ADDITIONAL_BUSINESS_TYPES);
const PROGRAM_SERVICE_IDS = knownIdsOf(PROGRAM_SERVICES);

const sectionLabelClass = 'text-base font-semibold text-foreground md:text-lg';
const fieldLabelClass =
  '[&>label]:text-base [&>label]:font-semibold [&>label]:text-foreground md:[&>label]:text-lg';

function readDraft(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem('onboarding_data') || '{}');
  } catch {
    return {};
  }
}

interface OptionCheckboxGridProps {
  options: readonly OnboardingOption[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  otherText: string;
  onOtherTextChange: (value: string) => void;
  otherError?: string;
}

function OptionCheckboxGrid({
  options,
  selected,
  onToggle,
  otherText,
  onOtherTextChange,
  otherError,
}: OptionCheckboxGridProps) {
  const otherActive = selected.includes(OTHER_OPTION_ID);

  return (
    <div className="flex flex-col gap-6">
      {/* The design's 130px gutter only fits once the container reaches its
          1080px cap; below that it eats the columns and wraps every long option
          onto two or three lines, so it is held back to xl. */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 sm:gap-x-12 sm:gap-y-[37px] sm:px-[30px] xl:gap-x-[130px]">
        {options.map((option) =>
          option.id === OTHER_OPTION_ID ? (
            <button
              key={option.id}
              type="button"
              aria-pressed={otherActive}
              onClick={() => onToggle(option.id, !otherActive)}
              className="flex min-w-0 cursor-pointer items-center gap-3 text-left"
            >
              <PlusCircle className="size-7 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 text-lg break-words text-primary">{option.label}</span>
            </button>
          ) : (
            <label key={option.id} className="flex min-w-0 cursor-pointer items-center gap-3">
              <Checkbox
                className="size-7 rounded-[4px]"
                checked={selected.includes(option.id)}
                onCheckedChange={(checked) => onToggle(option.id, checked === true)}
              />
              <span className="min-w-0 text-lg break-words text-foreground">{option.label}</span>
            </label>
          ),
        )}
      </div>

      {otherActive && (
        <div className="sm:px-[30px]">
          <Field error={otherError}>
            <Input
              value={otherText}
              onChange={(event) => onOtherTextChange(event.target.value)}
              placeholder="Please specify"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

export default function OnboardingStep3() {
  const { captureStepCompleted } = useOnboardingStep(3);
  const router = useRouter();
  const {
    control,
    register,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<Step3FormData>({ defaultValues: BLANK_STEP3_VALUES });

  const additionalTypes = useController({
    name: 'additionalBusinessTypes',
    control,
    rules: { validate: (value) => value.length > 0 || 'Additional Business Type is required' },
  });
  const additionalOther = useController({
    name: 'additionalBusinessTypeOtherText',
    control,
    rules: {
      validate: (value, formValues) =>
        !formValues.additionalBusinessTypes.includes(OTHER_OPTION_ID) ||
        value.trim().length > 0 ||
        'Please specify your additional business type',
    },
  });
  const services = useController({ name: 'services', control });
  const servicesOther = useController({
    name: 'servicesOtherText',
    control,
    rules: {
      validate: (value, formValues) =>
        !formValues.services.includes(OTHER_OPTION_ID) ||
        value.trim().length > 0 ||
        'Please specify the program service',
    },
  });

  useEffect(() => {
    const step3 = readDraft().step3 as PersistedStep3 | undefined;
    if (!step3) return;

    const primary = hydrateSingleSelection(step3.primaryBusinessType, PRIMARY_BUSINESS_TYPE_IDS);
    const additional = hydrateSelection(
      step3.additionalBusinessTypes,
      ADDITIONAL_BUSINESS_TYPE_IDS,
    );
    const programServices = hydrateSelection(step3.services, PROGRAM_SERVICE_IDS);

    reset({
      primaryBusinessType: primary.selectedId,
      primaryBusinessTypeOtherText: primary.otherText,
      additionalBusinessTypes: additional.selectedIds,
      additionalBusinessTypeOtherText: additional.otherText,
      services: programServices.selectedIds,
      servicesOtherText: programServices.otherText,
    });
  }, [reset]);

  const primaryBusinessType = useWatch({ control, name: 'primaryBusinessType' });

  const toggleIn = (current: string[], id: string, checked: boolean) =>
    checked ? [...current, id] : current.filter((value) => value !== id);

  const onSubmit = (data: Step3FormData) => {
    try {
      if (typeof window !== 'undefined') {
        const draft = readDraft();
        draft.step3 = {
          primaryBusinessType: resolveSingleSelection(
            data.primaryBusinessType,
            data.primaryBusinessTypeOtherText,
          ),
          additionalBusinessTypes: resolveSelection(
            data.additionalBusinessTypes,
            data.additionalBusinessTypeOtherText,
          ),
          services: resolveSelection(data.services, data.servicesOtherText),
        };
        localStorage.setItem('onboarding_data', JSON.stringify(draft));
      }
      captureStepCompleted();
      router.push('/onboarding/step4');
    } catch (error) {
      logger.error({ msg: '[onboarding] Step 3 local save failed', err: error });
    }
  };

  return (
    <div className="w-full max-w-[1080px]">
      <Stepper currentStep={3} />

      <h1 className="mb-2 text-center text-[22px] font-bold text-foreground md:text-[28px]">
        Help us understand your Services
      </h1>
      <p className="mb-6 text-center text-sm text-text-secondary md:mb-12 md:text-base">
        Choose the services that reflect the people you serve.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8 md:gap-10">
        <div className="flex flex-col gap-6">
          <Controller
            name="primaryBusinessType"
            control={control}
            rules={{ required: 'Primary Business Type is required' }}
            render={({ field }) => (
              <Field
                label="Primary Business Type"
                required
                error={errors.primaryBusinessType?.message}
                className={fieldLabelClass}
              >
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    // Radix renders a hidden native <select> whenever a Select sits
                    // inside a <form>, and echoes a change event back through
                    // onValueChange when the value is set programmatically. The echo
                    // reports "" until the matching <option> has registered, which
                    // would wipe the value rehydrated from the localStorage draft.
                    // No SelectItem here has an empty value, so "" is only ever that
                    // echo — never a real user selection.
                    if (!value) return;
                    field.onChange(value);
                  }}
                >
                  <SelectTrigger className="h-14 w-full rounded-[13px]">
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIMARY_BUSINESS_TYPES.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />

          {primaryBusinessType === OTHER_OPTION_ID && (
            <Field error={errors.primaryBusinessTypeOtherText?.message}>
              <Input
                {...register('primaryBusinessTypeOtherText', {
                  validate: (value, formValues) =>
                    formValues.primaryBusinessType !== OTHER_OPTION_ID ||
                    value.trim().length > 0 ||
                    'Please specify your business type',
                })}
                placeholder="Please specify"
              />
            </Field>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <span className={sectionLabelClass}>
            Additional Business Type{' '}
            <span className="text-error" aria-hidden="true">
              *
            </span>
          </span>
          <OptionCheckboxGrid
            options={ADDITIONAL_BUSINESS_TYPES}
            selected={additionalTypes.field.value}
            onToggle={(id, checked) =>
              additionalTypes.field.onChange(toggleIn(additionalTypes.field.value, id, checked))
            }
            otherText={additionalOther.field.value}
            onOtherTextChange={additionalOther.field.onChange}
            otherError={additionalOther.fieldState.error?.message}
          />
          {additionalTypes.fieldState.error?.message && (
            <p className="text-sm text-error">{additionalTypes.fieldState.error.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <span className={sectionLabelClass}>Program Services</span>
          <OptionCheckboxGrid
            options={PROGRAM_SERVICES}
            selected={services.field.value}
            onToggle={(id, checked) =>
              services.field.onChange(toggleIn(services.field.value, id, checked))
            }
            otherText={servicesOther.field.value}
            onOtherTextChange={servicesOther.field.onChange}
            otherError={servicesOther.fieldState.error?.message}
          />
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:justify-between md:gap-4">
          <Button
            variant="outline"
            type="button"
            onClick={() => router.push('/onboarding/step2')}
            className="w-full md:w-auto"
          >
            Back
          </Button>
          <Button type="submit" className="w-full md:w-auto">
            Next
          </Button>
        </div>
      </form>
    </div>
  );
}
