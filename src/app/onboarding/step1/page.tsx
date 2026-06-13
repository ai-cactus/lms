'use client';

import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { PhoneInput } from '@/components/ui';
import { Button } from '@/components/ui/button';
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

interface Step1FormData {
  legalName: string;
  dba: string;
  ein: string;
  staffCount: string;
  primaryContactName: string;
  primaryContactEmail: string;
  phone: string;
  country: string;
  streetAddress: string;
  zipCode: string;
  city: string;
  state: string;
}

const US_STATES = [
  { label: 'Alabama', value: 'AL' },
  { label: 'Alaska', value: 'AK' },
  { label: 'Arizona', value: 'AZ' },
  { label: 'Arkansas', value: 'AR' },
  { label: 'California', value: 'CA' },
  { label: 'Colorado', value: 'CO' },
  { label: 'Connecticut', value: 'CT' },
  { label: 'Delaware', value: 'DE' },
  { label: 'District of Columbia', value: 'DC' },
  { label: 'Florida', value: 'FL' },
  { label: 'Georgia', value: 'GA' },
  { label: 'Hawaii', value: 'HI' },
  { label: 'Idaho', value: 'ID' },
  { label: 'Illinois', value: 'IL' },
  { label: 'Indiana', value: 'IN' },
  { label: 'Iowa', value: 'IA' },
  { label: 'Kansas', value: 'KS' },
  { label: 'Kentucky', value: 'KY' },
  { label: 'Louisiana', value: 'LA' },
  { label: 'Maine', value: 'ME' },
  { label: 'Maryland', value: 'MD' },
  { label: 'Massachusetts', value: 'MA' },
  { label: 'Michigan', value: 'MI' },
  { label: 'Minnesota', value: 'MN' },
  { label: 'Mississippi', value: 'MS' },
  { label: 'Missouri', value: 'MO' },
  { label: 'Montana', value: 'MT' },
  { label: 'Nebraska', value: 'NE' },
  { label: 'Nevada', value: 'NV' },
  { label: 'New Hampshire', value: 'NH' },
  { label: 'New Jersey', value: 'NJ' },
  { label: 'New Mexico', value: 'NM' },
  { label: 'New York', value: 'NY' },
  { label: 'North Carolina', value: 'NC' },
  { label: 'North Dakota', value: 'ND' },
  { label: 'Ohio', value: 'OH' },
  { label: 'Oklahoma', value: 'OK' },
  { label: 'Oregon', value: 'OR' },
  { label: 'Pennsylvania', value: 'PA' },
  { label: 'Rhode Island', value: 'RI' },
  { label: 'South Carolina', value: 'SC' },
  { label: 'South Dakota', value: 'SD' },
  { label: 'Tennessee', value: 'TN' },
  { label: 'Texas', value: 'TX' },
  { label: 'Utah', value: 'UT' },
  { label: 'Vermont', value: 'VT' },
  { label: 'Virginia', value: 'VA' },
  { label: 'Washington', value: 'WA' },
  { label: 'West Virginia', value: 'WV' },
  { label: 'Wisconsin', value: 'WI' },
  { label: 'Wyoming', value: 'WY' },
];

export default function OnboardingStep1() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<Step1FormData>({
    defaultValues: { country: 'US' },
  });

  const onSubmit = async (data: Step1FormData) => {
    logger.info({ msg: 'Step 1 Data Saved Locally:', data: data });
    try {
      // Check availability
      const { checkOrganizationNameAvailable } = await import('@/app/actions/organization');
      const result = await checkOrganizationNameAvailable(data.legalName);

      if (!result.available) {
        setError('legalName', {
          type: 'manual',
          message:
            'Organization with this name already exists. Please contact your admin for access.',
        });
        return;
      }

      // Save to localStorage
      if (typeof window !== 'undefined') {
        const existing = JSON.parse(localStorage.getItem('onboarding_data') || '{}');
        const updated = { ...existing, step1: data };
        localStorage.setItem('onboarding_data', JSON.stringify(updated));
      }
      router.push('/onboarding/step2');
    } catch (error) {
      logger.error({ msg: 'Local save error:', err: error });
    }
  };

  // Helper to get error message safely
  const getError = (fieldName: keyof Step1FormData) => {
    return errors[fieldName]?.message;
  };

  return (
    <div className="w-full max-w-[1000px]">
      <Stepper currentStep={1} />

      <h1 className="mb-2 text-center text-[22px] font-bold text-foreground md:text-[28px]">
        Tell us about your organization
      </h1>
      <p className="mb-6 text-center text-sm text-text-secondary md:mb-12 md:text-base">
        Tell us about your organization so we can tailor the compliance analysis to your needs.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4 rounded-2xl bg-background p-6 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] md:gap-6 md:p-10"
      >
        <Field label="Legal Business Name" required error={getError('legalName')}>
          <Input
            {...register('legalName', { required: 'Legal Business Name is required' })}
            placeholder="e.g. Acme Healthcare Ltd"
          />
        </Field>

        <Field label="Doing Business As (DBA)" required error={getError('dba')}>
          <Input
            {...register('dba', { required: 'DBA is required' })}
            placeholder="Enter business name (if applicable)"
          />
        </Field>

        <div className="flex flex-col gap-4 md:flex-row md:gap-6">
          <div className="flex flex-1 flex-col gap-1.5">
            <Field label="Employer Identification Number (EIN)" helperText="(optional)">
              <Controller
                name="ein"
                control={control}
                render={({ field }) => (
                  <Input
                    value={field.value || ''}
                    onChange={(e) => {
                      const rawValue = e.target.value;
                      const digits = rawValue.replace(/\D/g, '').slice(0, 9);
                      let formatted = '';
                      if (digits.length > 2) {
                        formatted = `${digits.substring(0, 2)}-${digits.substring(2)}`;
                      } else if (digits.length === 2) {
                        if (field.value === `${digits}-` && rawValue === digits) {
                          formatted = digits.substring(0, 1);
                        } else {
                          formatted = `${digits}-`;
                        }
                      } else {
                        formatted = digits;
                      }
                      field.onChange(formatted);
                    }}
                    placeholder="XX-XXXXXXX"
                    maxLength={10}
                  />
                )}
              />
            </Field>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Controller
              name="staffCount"
              control={control}
              rules={{ required: 'Staff Count is required' }}
              render={({ field }) => (
                <Field label="Number of Staff" required error={getError('staffCount')}>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-14 w-full rounded-[10px]">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1-10">1-10</SelectItem>
                      <SelectItem value="11-49">11-49</SelectItem>
                      <SelectItem value="50-499">50-499</SelectItem>
                      <SelectItem value="500+">500+</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:gap-6">
          <div className="flex flex-1 flex-col gap-1.5">
            <Field label="Primary Contact Name" required error={getError('primaryContactName')}>
              <Input
                {...register('primaryContactName', {
                  required: 'Primary Contact Name is required',
                })}
                placeholder="Enter the full name of the main contact"
              />
            </Field>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Field label="Primary Contact Email" required error={getError('primaryContactEmail')}>
              <Input
                {...register('primaryContactEmail', {
                  required: 'Primary Contact Email is required',
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: 'Invalid email address',
                  },
                })}
                type="email"
                placeholder="Enter the email address of the main contact"
              />
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:gap-6">
          <div className="flex flex-1 flex-col gap-1.5">
            <input type="hidden" {...register('country')} />
            <Field label="Country">
              <Input value="United States" readOnly tabIndex={-1} />
            </Field>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Controller
              name="phone"
              control={control}
              rules={{
                required: 'Phone Number is required',
                validate: (value) => {
                  const digits = value.replace(/\D/g, '');
                  if (digits.length < 10) return 'Phone number must be at least 10 digits';
                  return true;
                },
              }}
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-foreground">
                    Phone Number <span className="text-primary">*</span>
                  </label>
                  <PhoneInput
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="(XXX) XXX-XXXX"
                    error={getError('phone')}
                    allowedCountries={['US']}
                  />
                </div>
              )}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:gap-6">
          <div className="flex flex-1 flex-col gap-1.5">
            <Field label="Street Address" required error={getError('streetAddress')}>
              <Input
                {...register('streetAddress', { required: 'Street Address is required' })}
                placeholder="Enter business street address"
              />
            </Field>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Field label="Zip Code" required error={getError('zipCode')}>
              <Input
                {...register('zipCode', { required: 'Zip Code is required' })}
                placeholder="e.g. 27601"
              />
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:gap-6">
          <div className="flex flex-1 flex-col gap-1.5">
            <Field label="City" required error={getError('city')}>
              <Input
                {...register('city', { required: 'City is required' })}
                placeholder="Enter city"
              />
            </Field>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Controller
              name="state"
              control={control}
              rules={{ required: 'State is required' }}
              render={({ field }) => (
                <Field label="State" required error={getError('state')}>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-14 w-full rounded-[10px]">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-4">
          <Button type="submit">Next</Button>
        </div>
      </form>
    </div>
  );
}
