'use client';

import React, { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Stepper from '@/components/onboarding/Stepper';
import { logger } from '@/lib/logger';

interface Step3FormData {
  primaryBusinessType: string;
  additionalBusinessTypes: string[];
  services: string[];
}

const OTHER_OPTION_ID = 'other';

const ADDITIONAL_BUSINESS_TYPES = [
  { id: 'community_mental_health', label: 'Community Mental Health Center' },
  { id: 'sud_treatment', label: 'Substance Use Disorder (SUD) Treatment Center' },
  {
    id: 'addiction_programs',
    label: 'Outpatient or residential programs focused on addiction services',
  },
  { id: 'residential_inpatient', label: 'Residential / Inpatient Facility' },
  {
    id: 'behavioral_hospital',
    label: 'Behavioral health hospitals, crisis stabilization units, or long-term care programs',
  },
  { id: 'school_campus', label: 'School- or Campus-based Program' },
  { id: OTHER_OPTION_ID, label: 'Other (Specify)' },
];

const LABEL_BY_ID = new Map(ADDITIONAL_BUSINESS_TYPES.map((o) => [o.id, o.label]));

const PROGRAM_SERVICES = [
  { id: 'aging', label: 'Aging Services' },
  { id: 'behavioral', label: 'Behavioral Health' },
  { id: 'child-youth', label: 'Child & Youth Services' },
  { id: 'employment', label: 'Employment & Community Services' },
  { id: 'medical-rehab', label: 'Medical Rehabilitation' },
  { id: 'opioid', label: 'Opioid Treatment Program' },
  { id: 'vision', label: 'Vision Rehabilitation Services' },
];

export default function OnboardingStep3() {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Step3FormData>({
    defaultValues: {
      primaryBusinessType: '',
      additionalBusinessTypes: [],
      services: [],
    },
  });
  const [otherText, setOtherText] = useState('');

  const onSubmit = (data: Step3FormData) => {
    if (data.additionalBusinessTypes.includes(OTHER_OPTION_ID) && !otherText.trim()) {
      setError('additionalBusinessTypes', {
        type: 'manual',
        message: 'Please specify your additional business type',
      });
      return;
    }

    // Convert selected option ids to their stored labels; the "Other" selection
    // stores the typed free text rather than the literal "Other (Specify)".
    const additionalBusinessTypes = data.additionalBusinessTypes.flatMap((id) =>
      id === OTHER_OPTION_ID
        ? otherText.trim()
          ? [otherText.trim()]
          : []
        : [LABEL_BY_ID.get(id) ?? id],
    );

    try {
      if (typeof window !== 'undefined') {
        const existing = JSON.parse(localStorage.getItem('onboarding_data') || '{}');
        const updated = {
          ...existing,
          step3: {
            primaryBusinessType: data.primaryBusinessType,
            additionalBusinessTypes,
            services: data.services,
          },
        };
        localStorage.setItem('onboarding_data', JSON.stringify(updated));
      }
      router.push('/onboarding/step4');
    } catch (error) {
      logger.error({ msg: 'Submission error:', err: error });
    }
  };

  const getError = (fieldName: keyof Step3FormData) => {
    return errors[fieldName]?.message;
  };

  return (
    <div className="w-full max-w-[1000px]">
      <Stepper currentStep={3} />

      <h1 className="mb-2 text-center text-[22px] font-bold text-foreground md:text-[28px]">
        Help us understand your Services
      </h1>
      <p className="mb-6 text-center text-sm text-text-secondary md:mb-12 md:text-base">
        Choose the services that reflect the people you serve.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4 rounded-2xl bg-background p-6 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] md:gap-6 md:p-10"
      >
        <div className="flex flex-col gap-4 md:flex-row md:gap-6">
          <div className="flex flex-1 flex-col gap-1.5">
            <Controller
              name="primaryBusinessType"
              control={control}
              rules={{ required: 'Primary Business Type is required' }}
              render={({ field }) => (
                <Field
                  label="Primary Business Type"
                  required
                  error={getError('primaryBusinessType')}
                >
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-14 w-full rounded-[10px]">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="solo">Solo / Independent Provider</SelectItem>
                      <SelectItem value="group">Group Practice</SelectItem>
                      <SelectItem value="clinic">Clinic</SelectItem>
                      <SelectItem value="hospital">Hospital</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Controller
              name="additionalBusinessTypes"
              control={control}
              rules={{ validate: (v) => v.length > 0 || 'Additional Business Type is required' }}
              render={({ field }) => {
                const summary =
                  field.value.length === 0
                    ? ''
                    : field.value
                        .map((id) =>
                          id === OTHER_OPTION_ID
                            ? otherText.trim() || 'Other'
                            : (LABEL_BY_ID.get(id) ?? id),
                        )
                        .join(', ');
                const toggle = (id: string, checked: boolean) => {
                  field.onChange(
                    checked ? [...field.value, id] : field.value.filter((v) => v !== id),
                  );
                };
                return (
                  <Field
                    label="Additional Business Type"
                    required
                    error={getError('additionalBusinessTypes')}
                  >
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={`flex h-14 w-full items-center justify-between gap-2 rounded-[10px] border bg-background px-3 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                            getError('additionalBusinessTypes')
                              ? 'border-destructive'
                              : 'border-input'
                          }`}
                        >
                          <span
                            className={
                              summary ? 'line-clamp-1 text-foreground' : 'text-muted-foreground'
                            }
                          >
                            {summary || 'Select an option'}
                          </span>
                          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-(--radix-popover-trigger-width) p-2"
                      >
                        <div className="flex flex-col">
                          {ADDITIONAL_BUSINESS_TYPES.map((option) => {
                            const isChecked = field.value.includes(option.id);
                            return (
                              <label
                                key={option.id}
                                className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm text-foreground hover:bg-accent"
                              >
                                <Checkbox
                                  className="mt-0.5"
                                  checked={isChecked}
                                  onCheckedChange={(c) => toggle(option.id, c === true)}
                                />
                                <span>{option.label}</span>
                              </label>
                            );
                          })}
                          {field.value.includes(OTHER_OPTION_ID) && (
                            <div className="p-2">
                              <Input
                                value={otherText}
                                onChange={(e) => setOtherText(e.target.value)}
                                placeholder="Please specify"
                              />
                            </div>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </Field>
                );
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="mb-4 block text-sm font-semibold text-foreground">
            Program Services
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PROGRAM_SERVICES.map((service) => (
              <Controller
                key={service.id}
                name="services"
                control={control}
                render={({ field }) => {
                  const isChecked = field.value.includes(service.id);
                  return (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(c) => {
                          if (c === true) {
                            field.onChange([...field.value, service.id]);
                          } else {
                            field.onChange(field.value.filter((v) => v !== service.id));
                          }
                        }}
                      />
                      {service.label}
                    </label>
                  );
                }}
              />
            ))}
          </div>
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
