'use client';

import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, PhoneInput } from '@/components/ui';
import styles from '@/app/onboarding/onboarding.module.css';
import Stepper from '@/components/onboarding/Stepper';

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

export default function OnboardingStep1() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<Step1FormData>();

  const onSubmit = async (data: Step1FormData) => {
    console.log('Step 1 Data Saved Locally:', data);
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
      console.error('Local save error:', error);
    }
  };

  // Helper to get error message safely
  const getError = (fieldName: keyof Step1FormData) => {
    return errors[fieldName]?.message;
  };

  return (
    <div className={styles.stepContainer}>
      <Stepper currentStep={1} />

      <h1 className={styles.stepTitle}>Tell us about your organization</h1>
      <p className={styles.stepDescription}>
        Tell us about your organization so we can tailor the compliance analysis to your needs.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className={styles.form}>
        <div className={styles.formGroup}>
          <label className={styles.label}>
            Legal Business Name <span className={styles.required}>*</span>
          </label>
          <Input
            {...register('legalName', { required: 'Legal Business Name is required' })}
            placeholder="e.g. Acme Healthcare Ltd"
            error={getError('legalName')}
          />
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label}>
            Doing Business As (DBA) <span className={styles.required}>*</span>
          </label>
          <Input
            {...register('dba', { required: 'DBA is required' })}
            placeholder="Enter business name (if applicable)"
            error={getError('dba')}
          />
        </div>

        <div className={styles.row}>
          <div className={`${styles.formGroup} ${styles.col}`}>
            <label className={styles.label}>
              Employer Identification Number (EIN){' '}
              <span className={styles.helperText}>(optional)</span>
            </label>
            <Input {...register('ein')} placeholder="Enter your EIN (if applicable)" />
          </div>
          <div className={`${styles.formGroup} ${styles.col}`}>
            <label className={styles.label}>
              Number of Staff <span className={styles.required}>*</span>
            </label>
            <Controller
              name="staffCount"
              control={control}
              rules={{ required: 'Staff Count is required' }}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { label: '1-10', value: '1-10' },
                    { label: '11-49', value: '11-49' },
                    { label: '50-499', value: '50-499' },
                    { label: '500+', value: '500+' },
                  ]}
                  placeholder="Select an option"
                  error={getError('staffCount')}
                />
              )}
            />
          </div>
        </div>

        <div className={styles.row}>
          <div className={`${styles.formGroup} ${styles.col}`}>
            <label className={styles.label}>
              Primary Contact Name <span className={styles.required}>*</span>
            </label>
            <Input
              {...register('primaryContactName', { required: 'Primary Contact Name is required' })}
              placeholder="Enter the full name of the main contact"
              error={getError('primaryContactName')}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.col}`}>
            <label className={styles.label}>
              Primary Contact Email <span className={styles.required}>*</span>
            </label>
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
              error={getError('primaryContactEmail')}
            />
          </div>
        </div>

        <div className={styles.row}>
          <div className={`${styles.formGroup} ${styles.col}`}>
            <label className={styles.label}>
              Country <span className={styles.required}>*</span>
            </label>
            <Controller
              name="country"
              control={control}
              rules={{ required: 'Country is required' }}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onChange={field.onChange}
                  options={[{ label: 'United States', value: 'US' }]}
                  placeholder="Select an option"
                  error={getError('country')}
                />
              )}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.col}`}>
            <label className={styles.label}>
              Phone Number <span className={styles.required}>*</span>
            </label>
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
                <PhoneInput
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Enter the phone number of the main contact"
                  error={getError('phone')}
                  allowedCountries={['US']}
                />
              )}
            />
          </div>
        </div>

        <div className={styles.row}>
          <div className={`${styles.formGroup} ${styles.col}`}>
            <label className={styles.label}>
              Street Address <span className={styles.helperText}>(optional)</span>
            </label>
            <Input {...register('streetAddress')} placeholder="Enter business street address" />
          </div>
          <div className={`${styles.formGroup} ${styles.col}`}>
            <label className={styles.label}>
              Zip Code <span className={styles.helperText}>(optional)</span>
            </label>
            <Input {...register('zipCode')} placeholder="e.g. 27601" />
          </div>
        </div>

        <div className={styles.row}>
          <div className={`${styles.formGroup} ${styles.col}`}>
            <label className={styles.label}>
              City <span className={styles.helperText}>(optional)</span>
            </label>
            <Input {...register('city')} placeholder="Enter city" />
          </div>
          <div className={`${styles.formGroup} ${styles.col}`}>
            <label className={styles.label}>
              State/Province <span className={styles.helperText}>(optional)</span>
            </label>
            <Controller
              name="state"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { label: 'Alabama', value: 'AL' },
                    { label: 'Alaska', value: 'AK' },
                    { label: 'Arizona', value: 'AZ' },
                    { label: 'Arkansas', value: 'AR' },
                    { label: 'California', value: 'CA' },
                    { label: 'Colorado', value: 'CO' },
                    { label: 'Connecticut', value: 'CT' },
                    { label: 'Delaware', value: 'DE' },
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
                    { label: 'District of Columbia', value: 'DC' },
                    { label: 'Alberta', value: 'AB' },
                    { label: 'British Columbia', value: 'BC' },
                    { label: 'Manitoba', value: 'MB' },
                    { label: 'New Brunswick', value: 'NB' },
                    { label: 'Newfoundland and Labrador', value: 'NL' },
                    { label: 'Nova Scotia', value: 'NS' },
                    { label: 'Ontario', value: 'ON' },
                    { label: 'Prince Edward Island', value: 'PE' },
                    { label: 'Quebec', value: 'QC' },
                    { label: 'Saskatchewan', value: 'SK' },
                    { label: 'Northwest Territories', value: 'NT' },
                    { label: 'Nunavut', value: 'NU' },
                    { label: 'Yukon', value: 'YT' },
                  ]}
                  placeholder="Select an option"
                />
              )}
            />
          </div>
        </div>

        <div className={styles.actions}>
          <Button variant="outline" type="button" onClick={() => router.push('/dashboard')}>
            Skip for now
          </Button>
          <Button variant="primary" type="submit">
            Next
          </Button>
        </div>
      </form>
    </div>
  );
}
