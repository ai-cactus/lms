'use client';

import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

interface Step3FormData {
  primaryBusinessType: string;
  additionalBusinessType: string;
  services: string[];
}

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
    formState: { errors },
  } = useForm<Step3FormData>({
    defaultValues: {
      services: [], // Initialize as empty array
    },
  });

  const onSubmit = (data: Step3FormData) => {
    try {
      if (typeof window !== 'undefined') {
        const existing = JSON.parse(localStorage.getItem('onboarding_data') || '{}');
        const updated = { ...existing, step3: data };
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
        Choose the services that reflect the people you service
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
              name="additionalBusinessType"
              control={control}
              rules={{ required: 'Additional Business Type is required' }}
              render={({ field }) => (
                <Field
                  label="Additional Business Type"
                  required
                  error={getError('additionalBusinessType')}
                >
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-14 w-full rounded-[10px]">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="non-profit">Non-Profit</SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="public">Public</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
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
          {errors.services && (
            <span className="mt-2 block text-sm text-error">
              Please select at least one service/although optional for logic check
            </span>
          )}
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
