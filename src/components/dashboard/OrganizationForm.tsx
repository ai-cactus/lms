'use client';

import React, { useState, useEffect } from 'react';
import { Copy, RefreshCw, TriangleAlert, Building2 } from 'lucide-react';
import { updateOrganization } from '@/app/actions/organization';
import { generateOrganizationCode, getOrganizationCode } from '@/app/actions/organization-code';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert } from '@/components/ui';
import { logger } from '@/lib/logger';

interface OrganizationData {
  id: string;
  name: string;
  dba?: string | null;
  ein?: string | null;
  primaryContact?: string | null;
  primaryEmail?: string | null;
  isHipaaCompliant?: boolean;
  primaryBusinessType?: string | null;
  additionalBusinessTypes?: string[];
}

interface OrganizationFormProps {
  initialData: OrganizationData | null;
  isAdmin: boolean;
}

// Exact options from onboarding/step2
const HIPAA_OPTIONS = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

// Exact options from onboarding/step3
const PRIMARY_BUSINESS_TYPES = [
  { label: 'Solo / Independent Provider', value: 'solo' },
  { label: 'Group Practice', value: 'group' },
  { label: 'Clinic', value: 'clinic' },
  { label: 'Hospital', value: 'hospital' },
];

const ADDITIONAL_BUSINESS_TYPES = [
  { label: 'Other', value: 'none' },
  { label: 'Non-Profit', value: 'non-profit' },
  { label: 'Private', value: 'private' },
  { label: 'Public', value: 'public' },
];

const labelClass = 'mb-2 block text-sm font-medium text-foreground';
const requiredClass = 'text-error';
const optionalClass = 'text-text-tertiary font-normal';

/** Labeled shadcn select matching the legacy Select API used across this form */
function FormSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  error,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <>
      <Select value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className="w-full" aria-invalid={!!error}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="mt-1 text-sm text-error">{error}</p>}
    </>
  );
}

function OrgCodeGenerator() {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCode() {
      try {
        const result = await getOrganizationCode();
        if (result.success && result.code) {
          setCode(result.code);
          setExpiresAt(result.expiresAt ? new Date(result.expiresAt) : null);
        }
      } catch (err) {
        logger.error({ msg: 'Error loading code', err });
      }
    }
    loadCode();
  }, []);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const result = await generateOrganizationCode();
      if (result.success && result.code) {
        setCode(result.code);
        setExpiresAt(result.expiresAt ? new Date(result.expiresAt) : null);
      } else {
        setError(result.error || 'Failed to generate code');
      }
    } catch {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  }

  const isExpired = expiresAt && new Date() > expiresAt;
  const timeLeft = expiresAt
    ? Math.max(0, Math.floor((expiresAt.getTime() - new Date().getTime()) / 60000))
    : 0;
  const hoursLeft = Math.floor(timeLeft / 60);
  const minsLeft = timeLeft % 60;

  const copyToClipboard = () => {
    if (code) {
      navigator.clipboard.writeText(code);
      // Could add a toast here
    }
  };

  return (
    <div className="w-full">
      {code ? (
        <div
          className={`flex flex-col gap-3 rounded-[10px] border p-4 ${
            isExpired ? 'border-error/40 bg-error/5' : 'border-border bg-background-secondary'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-2xl font-semibold tracking-[0.2em] text-foreground">
              {code}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              onClick={copyToClipboard}
              aria-label="Copy code"
            >
              <Copy className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {isExpired ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-error">
                <TriangleAlert className="size-3.5" aria-hidden="true" /> Expired
              </span>
            ) : (
              <span className="text-sm text-text-secondary">
                Expires in {hoursLeft}h {minsLeft}m
              </span>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={loading}
              className="gap-1.5"
            >
              <RefreshCw
                className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {isExpired ? 'Regenerate' : 'Generate New'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-text-secondary">
            Generate a temporary 6-digit code for workers to join your organization.
          </p>
          <Button type="button" onClick={handleGenerate} loading={loading}>
            Generate Code
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}

export default function OrganizationForm({ initialData, isAdmin }: OrganizationFormProps) {
  const [formData, setFormData] = useState<OrganizationData>(
    initialData || {
      id: '',
      name: '',
      dba: '',
      ein: '',
      primaryContact: '',
      primaryEmail: '',
      isHipaaCompliant: false,
      primaryBusinessType: '',
      additionalBusinessTypes: [],
    },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [baseData, setBaseData] = useState<OrganizationData | null>(
    initialData
      ? { ...initialData, additionalBusinessTypes: initialData.additionalBusinessTypes || [] }
      : null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (initialData) {
      const formatted = {
        ...initialData,
        additionalBusinessTypes: initialData.additionalBusinessTypes || [],
      };
      setFormData(formatted);
      setBaseData(formatted);
    }
  }, [initialData]);

  const isDirty =
    !baseData ||
    formData.name !== baseData.name ||
    formData.dba !== baseData.dba ||
    formData.ein !== baseData.ein ||
    formData.primaryContact !== baseData.primaryContact ||
    formData.primaryEmail !== baseData.primaryEmail ||
    formData.isHipaaCompliant !== baseData.isHipaaCompliant ||
    formData.primaryBusinessType !== baseData.primaryBusinessType ||
    JSON.stringify(formData.additionalBusinessTypes || []) !==
      JSON.stringify(baseData.additionalBusinessTypes || []);

  /** Format a raw value into EIN format: XX-XXXXXXX */
  const handleEinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const digits = rawValue.replace(/\D/g, '').slice(0, 9);

    setFormData((prev) => {
      let formatted = '';
      if (digits.length > 2) {
        formatted = `${digits.substring(0, 2)}-${digits.substring(2)}`;
      } else if (digits.length === 2) {
        // Handle backspace over hyphen using latest state
        if (prev.ein === `${digits}-` && rawValue === digits) {
          formatted = digits.substring(0, 1);
        } else {
          formatted = `${digits}-`;
        }
      } else {
        formatted = digits;
      }
      return { ...prev, ein: formatted };
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    // Get first value from additionalBusinessTypes array or empty string
    const additionalBizType = (formData.additionalBusinessTypes || [])[0] || '';

    // Validate required fields
    const newErrors: Record<string, string> = {};
    if (!formData.name?.trim()) newErrors.name = 'Legal Business Name is required';
    if (!formData.dba?.trim()) newErrors.dba = 'DBA is required';
    if (!formData.primaryContact?.trim()) newErrors.primaryContact = 'Primary Contact is required';
    if (!formData.primaryEmail?.trim()) newErrors.primaryEmail = 'Primary Email is required';
    if (!formData.primaryBusinessType)
      newErrors.primaryBusinessType = 'Primary Business Type is required';
    if (!additionalBizType)
      newErrors.additionalBusinessType = 'Additional Business Type is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setMessage({
        type: 'error',
        text: 'Please fill out all required fields marked with an asterisk (*).',
      });
      return;
    }

    setErrors({});
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await updateOrganization({
        name: formData.name,
        dba: formData.dba || undefined,
        ein: formData.ein || undefined,
        primaryContact: formData.primaryContact || undefined,
        primaryEmail: formData.primaryEmail || undefined,
        isHipaaCompliant: formData.isHipaaCompliant,
        primaryBusinessType: formData.primaryBusinessType || undefined,
        additionalBusinessTypes: additionalBizType ? [additionalBizType] : [],
      });

      if (result.success) {
        setMessage({ type: 'success', text: 'Organization updated successfully' });
        setBaseData({
          ...formData,
          additionalBusinessTypes: additionalBizType ? [additionalBizType] : [],
        });
        router.refresh();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscard = () => {
    if (baseData) {
      setFormData({
        ...baseData,
        additionalBusinessTypes: baseData.additionalBusinessTypes || [],
      });
    }
    setMessage(null);
  };

  if (!initialData) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-6">
        <div className="flex max-w-[420px] flex-col items-center text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Building2 className="size-8" aria-hidden="true" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-foreground">No Organization Found</h3>
          <p className="mb-6 text-sm leading-relaxed text-text-secondary">
            You haven&apos;t set up an organization profile yet. Complete the onboarding process to
            unlock all features.
          </p>
          <Button onClick={() => router.push('/onboarding/step1')}>Complete Onboarding</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-10 p-6 md:p-10">
      {/* Section 1: Basic Organization Information */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <span className="text-primary">1.</span>
          <span>Basic Organization Information</span>
        </div>

        <div>
          <label className={labelClass}>
            Legal Business Name <span className={requiredClass}>*</span>
          </label>
          <Input
            name="name"
            value={formData.name || ''}
            onChange={handleChange}
            placeholder="e.g. Acme Healthcare Ltd"
            disabled={!isAdmin}
            aria-invalid={!!errors.name}
          />
          {errors.name && <p className="mt-1 text-sm text-error">{errors.name}</p>}
        </div>

        <div>
          <label className={labelClass}>
            Doing Business As (DBA) <span className={requiredClass}>*</span>
          </label>
          <Input
            name="dba"
            value={formData.dba || ''}
            onChange={handleChange}
            placeholder="Enter business name (if applicable)"
            disabled={!isAdmin}
            aria-invalid={!!errors.dba}
          />
          {errors.dba && <p className="mt-1 text-sm text-error">{errors.dba}</p>}
        </div>

        <div>
          <label className={labelClass}>
            Employer Identification Number (EIN) <span className={optionalClass}>(optional)</span>
          </label>
          <Input
            name="ein"
            value={formData.ein || ''}
            onChange={handleEinChange}
            placeholder="XX-XXXXXXX"
            disabled={!isAdmin}
            maxLength={10}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              Primary Contact Name <span className={requiredClass}>*</span>
            </label>
            <Input
              name="primaryContact"
              value={formData.primaryContact || ''}
              onChange={handleChange}
              placeholder="Enter the full name of the main contact"
              disabled={!isAdmin}
              aria-invalid={!!errors.primaryContact}
            />
            {errors.primaryContact && (
              <p className="mt-1 text-sm text-error">{errors.primaryContact}</p>
            )}
          </div>
          <div>
            <label className={labelClass}>
              Primary Contact Email <span className={requiredClass}>*</span>
            </label>
            <Input
              name="primaryEmail"
              value={formData.primaryEmail || ''}
              onChange={handleChange}
              placeholder="Enter the email address of the main contact"
              type="email"
              disabled={!isAdmin}
              aria-invalid={!!errors.primaryEmail}
            />
            {errors.primaryEmail && (
              <p className="mt-1 text-sm text-error">{errors.primaryEmail}</p>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Credentialing & Documentation */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <span className="text-primary">2.</span>
          <span>Credentialing &amp; Documentation</span>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              HIPAA Compliance Confirmation <span className={requiredClass}>*</span>
            </label>
            <FormSelect
              value={formData.isHipaaCompliant ? 'yes' : 'no'}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, isHipaaCompliant: value === 'yes' }))
              }
              options={HIPAA_OPTIONS}
              placeholder="Select an option"
              disabled={!isAdmin}
            />
          </div>
        </div>
      </div>

      {/* Section 3: Organization Services */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <span className="text-primary">3.</span>
          <span>Organization Services</span>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              Primary Business Type <span className={requiredClass}>*</span>
            </label>
            <FormSelect
              value={formData.primaryBusinessType || ''}
              onValueChange={(value) => handleSelectChange('primaryBusinessType', value)}
              options={PRIMARY_BUSINESS_TYPES}
              placeholder="Select an option"
              disabled={!isAdmin}
              error={errors.primaryBusinessType}
            />
          </div>
          <div>
            <label className={labelClass}>
              Additional Business Type <span className={requiredClass}>*</span>
            </label>
            <FormSelect
              value={(formData.additionalBusinessTypes || [])[0] || ''}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, additionalBusinessTypes: value ? [value] : [] }))
              }
              options={ADDITIONAL_BUSINESS_TYPES}
              placeholder="Select an option"
              disabled={!isAdmin}
              error={errors.additionalBusinessType}
            />
          </div>
        </div>
      </div>

      {/* Section: Worker Onboarding Code */}
      {isAdmin && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <span className="text-primary">4.</span>
            <span>Worker Onboarding</span>
          </div>

          <div>
            <label className={labelClass}>
              Organization Join Code
              <span className={optionalClass}> (Share this code with your workers)</span>
            </label>

            <div className="mt-2 max-w-md">
              <OrgCodeGenerator />
            </div>
          </div>
        </div>
      )}

      {message && (
        <Alert variant={message.type === 'success' ? 'success' : 'error'}>{message.text}</Alert>
      )}

      {isAdmin && isDirty && (
        <div className="flex justify-end gap-4">
          <Button variant="outline" type="button" onClick={handleDiscard}>
            Discard
          </Button>
          <Button type="submit" loading={isLoading}>
            Save Changes
          </Button>
        </div>
      )}
    </form>
  );
}
