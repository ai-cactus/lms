'use client';

import React from 'react';
import { Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PhoneInput } from '@/components/ui';

interface FacilityData {
  id: string;
  name: string;
  staffCount?: string | null;
  phone?: string | null;
  address?: string | null;
  country?: string | null;
  state?: string | null;
  zipCode?: string | null;
  city?: string | null;
  licenseNumber?: string | null;
  programServices?: string[];
  complianceDocumentUrl?: string | null;
  complianceDocumentName?: string | null;
  complianceDocumentDisplayUrl?: string | null;
}

interface FacilityFormProps {
  initialData: FacilityData | null;
}

// Options mirror those used during onboarding (see OrganizationForm).
const STAFF_COUNT_OPTIONS = [
  { label: '1-10', value: '1-10' },
  { label: '11-49', value: '11-49' },
  { label: '50-499', value: '50-499' },
  { label: '500+', value: '500+' },
];

const COUNTRY_OPTIONS = [{ label: 'United States', value: 'US' }];

const STATE_OPTIONS = [
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

const PROGRAM_SERVICES = [
  { id: 'aging', label: 'Aging Services' },
  { id: 'behavioral', label: 'Behavioral Health' },
  { id: 'child-youth', label: 'Child & Youth Services' },
  { id: 'employment', label: 'Employment & Community Services' },
  { id: 'medical-rehab', label: 'Medical Rehabilitation' },
  { id: 'opioid', label: 'Opioid Treatment Program' },
  { id: 'vision', label: 'Vision Rehabilitation Services' },
];

const labelClass = 'mb-2 block text-sm font-medium text-foreground';
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

export default function FacilityForm({ initialData }: FacilityFormProps) {
  if (!initialData) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-6">
        <div className="flex max-w-[420px] flex-col items-center text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Building2 className="size-8" aria-hidden="true" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-foreground">No Facility Found</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            There is no facility associated with your account yet.
          </p>
        </div>
      </div>
    );
  }

  const programServices = initialData.programServices || [];

  return (
    <div className="flex flex-col gap-10 p-6 md:p-10">
      {/* Section 1: Facility Information */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <span className="text-primary">1.</span>
          <span>Facility Information</span>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              Number of Staff <span className={optionalClass}>(optional)</span>
            </label>
            <ReadOnlySelect
              value={initialData.staffCount || ''}
              options={STAFF_COUNT_OPTIONS}
              placeholder="Select an option"
            />
          </div>
          <div>
            <label className={labelClass}>
              Country <span className={optionalClass}>(optional)</span>
            </label>
            <ReadOnlySelect
              value={initialData.country || ''}
              options={COUNTRY_OPTIONS}
              placeholder="Select an option"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              Phone Number <span className={optionalClass}>(optional)</span>
            </label>
            <PhoneInput
              value={initialData.phone || ''}
              placeholder="(XXX)-XXX-XXXX"
              allowedCountries={['US']}
              disabled
            />
          </div>
          <div>
            <label className={labelClass}>
              Zip Code <span className={optionalClass}>(optional)</span>
            </label>
            <Input
              name="zipCode"
              value={initialData.zipCode || ''}
              placeholder="e.g. 27601"
              disabled
              readOnly
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>
            Street Address <span className={optionalClass}>(optional)</span>
          </label>
          <Input
            name="address"
            value={initialData.address || ''}
            placeholder="Enter facility street address"
            disabled
            readOnly
          />
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              City <span className={optionalClass}>(optional)</span>
            </label>
            <Input
              name="city"
              value={initialData.city || ''}
              placeholder="Enter city"
              disabled
              readOnly
            />
          </div>
          <div>
            <label className={labelClass}>
              State <span className={optionalClass}>(optional)</span>
            </label>
            <ReadOnlySelect
              value={initialData.state || ''}
              options={STATE_OPTIONS}
              placeholder="Select an option"
            />
          </div>
        </div>
      </div>

      {/* Section 2: Credentialing & Documentation */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <span className="text-primary">2.</span>
          <span>Credentialing &amp; Documentation</span>
        </div>

        <div>
          <label className={labelClass}>
            State Healthcare License Number <span className={optionalClass}>(optional)</span>
          </label>
          <Input
            name="licenseNumber"
            value={initialData.licenseNumber || ''}
            placeholder="Enter your official license number"
            disabled
            readOnly
          />
        </div>

        {initialData.complianceDocumentName && (
          <div>
            <label className={labelClass}>
              Compliance certifications <span className={optionalClass}>(optional)</span>
            </label>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-foreground">
                {initialData.complianceDocumentName}
              </span>
              {initialData.complianceDocumentUrl && (
                <a
                  href={
                    initialData.complianceDocumentDisplayUrl || initialData.complianceDocumentUrl
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline"
                >
                  View
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Facility Services */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <span className="text-primary">3.</span>
          <span>Facility Services</span>
        </div>

        <div>
          <label className={`${labelClass} mb-4`}>Program Services</label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PROGRAM_SERVICES.map((service) => (
              <div key={service.id} className="flex items-center gap-2">
                <Checkbox
                  id={`facility-program-${service.id}`}
                  checked={programServices.includes(service.id)}
                  disabled
                />
                <label
                  htmlFor={`facility-program-${service.id}`}
                  className="text-sm text-foreground select-none"
                >
                  {service.label}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
