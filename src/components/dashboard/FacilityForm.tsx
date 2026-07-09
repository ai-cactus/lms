'use client';

import React, { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import { updateFacility, uploadComplianceDocument } from '@/app/actions/organization';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PhoneInput, Alert } from '@/components/ui';

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
  canEdit: boolean;
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

/** Labeled shadcn select matching the legacy Select API used across these forms */
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

const emptyFacility: FacilityData = {
  id: '',
  name: '',
  staffCount: '',
  phone: '',
  address: '',
  country: '',
  state: '',
  zipCode: '',
  city: '',
  licenseNumber: '',
  programServices: [],
};

export default function FacilityForm({ initialData, canEdit }: FacilityFormProps) {
  const [formData, setFormData] = useState<FacilityData>(initialData || emptyFacility);
  const [baseData, setBaseData] = useState<FacilityData | null>(
    initialData ? { ...initialData, programServices: initialData.programServices || [] } : null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (initialData) {
      const formatted = { ...initialData, programServices: initialData.programServices || [] };
      setFormData(formatted);
      setBaseData(formatted);
    }
  }, [initialData]);

  const isDirty =
    !baseData ||
    formData.staffCount !== baseData.staffCount ||
    formData.phone !== baseData.phone ||
    formData.address !== baseData.address ||
    formData.country !== baseData.country ||
    formData.state !== baseData.state ||
    formData.zipCode !== baseData.zipCode ||
    formData.city !== baseData.city ||
    formData.licenseNumber !== baseData.licenseNumber ||
    JSON.stringify(formData.programServices || []) !==
      JSON.stringify(baseData.programServices || []) ||
    formData.complianceDocumentUrl !== baseData.complianceDocumentUrl;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleProgramServiceToggle = (serviceId: string) => {
    setFormData((prev) => {
      const current = prev.programServices || [];
      return current.includes(serviceId)
        ? { ...prev, programServices: current.filter((s) => s !== serviceId) }
        : { ...prev, programServices: [...current, serviceId] };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    setIsLoading(true);
    setMessage(null);

    try {
      const result = await updateFacility({
        staffCount: formData.staffCount || undefined,
        phone: formData.phone || undefined,
        address: formData.address || undefined,
        city: formData.city || undefined,
        country: formData.country || undefined,
        state: formData.state || undefined,
        zipCode: formData.zipCode || undefined,
        licenseNumber: formData.licenseNumber || undefined,
        programServices: formData.programServices || [],
      });

      if (result.success) {
        setMessage({ type: 'success', text: 'Facility updated successfully' });
        setBaseData({ ...formData });
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

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingDocument(true);
    const data = new FormData();
    data.append('file', file);

    try {
      const result = await uploadComplianceDocument(data);
      if (result.success && result.url) {
        setFormData((prev) => ({
          ...prev,
          complianceDocumentUrl: result.url,
          complianceDocumentName: result.filename,
        }));
        setBaseData((prev) =>
          prev
            ? {
                ...prev,
                complianceDocumentUrl: result.url,
                complianceDocumentName: result.filename,
              }
            : prev,
        );
        setMessage({ type: 'success', text: 'Document uploaded successfully' });
        router.refresh();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to upload document' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Upload failed' });
    } finally {
      setIsUploadingDocument(false);
      e.target.value = '';
    }
  };

  const handleDiscard = () => {
    if (baseData) {
      setFormData({ ...baseData, programServices: baseData.programServices || [] });
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
          <h3 className="mb-2 text-lg font-semibold text-foreground">No Facility Found</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            There is no facility associated with your account yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-10 p-6 md:p-10">
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
            <FormSelect
              value={formData.staffCount || ''}
              onValueChange={(value) => handleSelectChange('staffCount', value)}
              options={STAFF_COUNT_OPTIONS}
              placeholder="Select an option"
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className={labelClass}>
              Country <span className={optionalClass}>(optional)</span>
            </label>
            <FormSelect
              value={formData.country || ''}
              onValueChange={(value) => handleSelectChange('country', value)}
              options={COUNTRY_OPTIONS}
              placeholder="Select an option"
              disabled={!canEdit}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              Phone Number <span className={optionalClass}>(optional)</span>
            </label>
            <PhoneInput
              value={formData.phone || ''}
              onChange={
                canEdit ? (val) => setFormData((prev) => ({ ...prev, phone: val })) : undefined
              }
              placeholder="(XXX)-XXX-XXXX"
              allowedCountries={['US']}
            />
          </div>
          <div>
            <label className={labelClass}>
              Zip Code <span className={optionalClass}>(optional)</span>
            </label>
            <Input
              name="zipCode"
              value={formData.zipCode || ''}
              onChange={handleChange}
              placeholder="e.g. 27601"
              disabled={!canEdit}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>
            Street Address <span className={optionalClass}>(optional)</span>
          </label>
          <Input
            name="address"
            value={formData.address || ''}
            onChange={handleChange}
            placeholder="Enter facility street address"
            disabled={!canEdit}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              City <span className={optionalClass}>(optional)</span>
            </label>
            <Input
              name="city"
              value={formData.city || ''}
              onChange={handleChange}
              placeholder="Enter city"
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className={labelClass}>
              State <span className={optionalClass}>(optional)</span>
            </label>
            <FormSelect
              value={formData.state || ''}
              onValueChange={(value) => handleSelectChange('state', value)}
              options={STATE_OPTIONS}
              placeholder="Select an option"
              disabled={!canEdit}
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
            value={formData.licenseNumber || ''}
            onChange={handleChange}
            placeholder="Enter your official license number"
            disabled={!canEdit}
          />
        </div>

        <div>
          <label className={labelClass}>
            Upload your compliance certifications <span className={optionalClass}>(optional)</span>
          </label>
          <div className="flex flex-col gap-2">
            {formData.complianceDocumentName ? (
              <div className="mb-2 flex items-center gap-4">
                <span className="text-sm font-medium text-foreground">
                  {formData.complianceDocumentName}
                </span>
                {formData.complianceDocumentUrl && (
                  <a
                    href={formData.complianceDocumentDisplayUrl || formData.complianceDocumentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline"
                  >
                    View
                  </a>
                )}
              </div>
            ) : null}
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                type="button"
                onClick={() => document.getElementById('facility-compliance-upload')?.click()}
                disabled={!canEdit || isUploadingDocument}
                loading={isUploadingDocument}
              >
                {formData.complianceDocumentUrl ? 'Replace Document' : 'Upload Document'}
              </Button>
              <input
                id="facility-compliance-upload"
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                className="hidden"
                onChange={handleDocumentUpload}
              />
            </div>
          </div>
        </div>
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
                  checked={(formData.programServices || []).includes(service.id)}
                  onCheckedChange={() => {
                    if (canEdit) handleProgramServiceToggle(service.id);
                  }}
                  disabled={!canEdit}
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

      {message && (
        <Alert variant={message.type === 'success' ? 'success' : 'error'}>{message.text}</Alert>
      )}

      {canEdit && isDirty && (
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
