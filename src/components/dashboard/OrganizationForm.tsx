'use client';

import { useState, useEffect } from 'react';
import { Copy, RefreshCw, TriangleAlert, Building2 } from 'lucide-react';
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
import { logger } from '@/lib/logger';
import {
  ADDITIONAL_BUSINESS_TYPES,
  PRIMARY_BUSINESS_TYPES,
  getOptionLabel,
} from '@/lib/constants/onboarding-options';
import { panelLabelClass, sectionHeadingClass } from './profile-tab-styles';

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
  // Gates the Worker Onboarding join-code generator only; organization data is read-only for everyone.
  isAdmin: boolean;
}

// Exact options from onboarding/step2
const HIPAA_OPTIONS = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

// Organizations onboarded before the step 3 option set was reworked still hold
// these ids; they are no longer offered, but must remain readable here.
const LEGACY_PRIMARY_BUSINESS_TYPE_LABELS: Record<string, string> = {
  solo: 'Solo / Independent Provider',
  group: 'Group Practice',
  clinic: 'Clinic',
  hospital: 'Hospital',
};

const requiredClass = 'text-error';
const optionalClass = 'text-text-tertiary font-normal';

/** Read-only shadcn select that displays the selected option's label. */
function ReadOnlySelect({
  value,
  options,
  placeholder,
}: {
  value: string;
  options: { label: string; value: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value || undefined} disabled>
      <SelectTrigger className="w-full">
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
  const router = useRouter();

  if (!initialData) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
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

  const primaryBusinessType = initialData.primaryBusinessType || '';
  const primaryBusinessTypeLabel = primaryBusinessType
    ? (getOptionLabel(PRIMARY_BUSINESS_TYPES, primaryBusinessType) ??
      LEGACY_PRIMARY_BUSINESS_TYPE_LABELS[primaryBusinessType] ??
      primaryBusinessType)
    : '';

  // Values that match no known id are the free text captured by "Other (specify)".
  const additionalBusinessTypeLabels = (initialData.additionalBusinessTypes || [])
    .map((value) => getOptionLabel(ADDITIONAL_BUSINESS_TYPES, value) ?? value)
    .join(', ');

  return (
    <div className="flex w-full flex-col gap-10">
      {/* Section 1: Basic Organization Information */}
      <div className="flex flex-col gap-[27.639px]">
        <div className={sectionHeadingClass}>1. Basic Organization Information</div>

        <div>
          <label className={panelLabelClass}>
            Legal Business Name <span className={requiredClass}>*</span>
          </label>
          <Input
            name="name"
            value={initialData.name || ''}
            placeholder="e.g. Acme Healthcare Ltd"
            disabled
            readOnly
          />
        </div>

        <div>
          <label className={panelLabelClass}>
            Doing Business As (DBA) <span className={requiredClass}>*</span>
          </label>
          <Input
            name="dba"
            value={initialData.dba || ''}
            placeholder="Enter business name (if applicable)"
            disabled
            readOnly
          />
        </div>

        <div>
          <label className={panelLabelClass}>
            Employer Identification Number (EIN) <span className={optionalClass}>(optional)</span>
          </label>
          <Input
            name="ein"
            value={initialData.ein || ''}
            placeholder="XX-XXXXXXX"
            disabled
            readOnly
          />
        </div>

        <div className="grid grid-cols-1 gap-x-[16.584px] gap-y-[27.639px] sm:grid-cols-2">
          <div>
            <label className={panelLabelClass}>
              Primary Contact Name <span className={requiredClass}>*</span>
            </label>
            <Input
              name="primaryContact"
              value={initialData.primaryContact || ''}
              placeholder="Enter the full name of the main contact"
              disabled
              readOnly
            />
          </div>
          <div>
            <label className={panelLabelClass}>
              Primary Contact Email <span className={requiredClass}>*</span>
            </label>
            <Input
              name="primaryEmail"
              value={initialData.primaryEmail || ''}
              placeholder="Enter the email address of the main contact"
              type="email"
              disabled
              readOnly
            />
          </div>
        </div>
      </div>

      {/* Section 2: Credentialing & Documentation */}
      <div className="flex flex-col gap-[27.639px]">
        <div className={sectionHeadingClass}>2. Credentialing &amp; Documentation</div>

        <div className="grid grid-cols-1 gap-x-[16.584px] gap-y-[27.639px] sm:grid-cols-2">
          <div>
            <label className={panelLabelClass}>
              HIPAA Compliance Confirmation <span className={requiredClass}>*</span>
            </label>
            <ReadOnlySelect
              value={initialData.isHipaaCompliant ? 'yes' : 'no'}
              options={HIPAA_OPTIONS}
              placeholder="Select an option"
            />
          </div>
        </div>
      </div>

      {/* Section 3: Organization Services */}
      <div className="flex flex-col gap-[27.639px]">
        <div className={sectionHeadingClass}>3. Organization Services</div>

        <div className="grid grid-cols-1 gap-x-[16.584px] gap-y-[27.639px] sm:grid-cols-2">
          <div>
            <label className={panelLabelClass}>
              Primary Business Type <span className={requiredClass}>*</span>
            </label>
            <Input
              name="primaryBusinessType"
              value={primaryBusinessTypeLabel}
              placeholder="Select an option"
              disabled
              readOnly
            />
          </div>
          <div>
            <label className={panelLabelClass}>
              Additional Business Type <span className={requiredClass}>*</span>
            </label>
            <Input
              name="additionalBusinessTypes"
              value={additionalBusinessTypeLabels}
              placeholder="Select an option"
              disabled
              readOnly
            />
          </div>
        </div>
      </div>

      {/* Section: Worker Onboarding Code */}
      {isAdmin && (
        <div className="flex flex-col gap-[27.639px]">
          <div className={sectionHeadingClass}>4. Worker Onboarding</div>

          <div>
            <label className={panelLabelClass}>
              Organization Join Code
              <span className={optionalClass}> (Share this code with your workers)</span>
            </label>

            <div className="mt-2 max-w-md">
              <OrgCodeGenerator />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
