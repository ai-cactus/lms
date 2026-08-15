'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useController, useForm } from 'react-hook-form';
import { Building2, FileText, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Alert, Field, PhoneInput } from '@/components/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { deleteFacilityComplianceDocument, updateOrganization } from '@/app/actions/organization';
import {
  ADDITIONAL_BUSINESS_TYPES,
  OTHER_OPTION_ID,
  PRIMARY_BUSINESS_TYPES,
  PROGRAM_SERVICES,
  getOptionLabel,
  type OnboardingOption,
} from '@/lib/constants/onboarding-options';
import {
  COUNTRY_OPTIONS,
  STAFF_COUNT_OPTIONS,
  US_STATES,
  getLabeledOption,
  type LabeledOption,
} from '@/lib/constants/location-options';
import {
  hydrateSelection,
  hydrateSingleSelection,
  resolveSelection,
  resolveSingleSelection,
} from '@/lib/onboarding/step3-selection';
import { formatFileSize } from '@/lib/utils';
import { sectionHeadingClass } from '../profile-tab-styles';
import OptionChipSelect from './OptionChipSelect';
import OrgCodeGenerator from './OrgCodeGenerator';
import { EM_DASH, PanelCard, ReadField } from './ui';
import type { ComplianceDocument, OrganizationSectionData } from './types';

interface MyOrganizationSectionProps {
  organization: OrganizationSectionData | null;
  complianceDocuments: ComplianceDocument[];
  canEdit: boolean;
}

const HIPAA_OPTIONS: readonly LabeledOption[] = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

/**
 * Organizations onboarded before the step 3 option set was reworked still hold
 * these ids; they are no longer offered, but must remain readable.
 */
const LEGACY_PRIMARY_BUSINESS_TYPE_LABELS: Record<string, string> = {
  solo: 'Solo / Independent Provider',
  group: 'Group Practice',
  clinic: 'Clinic',
  hospital: 'Hospital',
};

/**
 * "Other" is excluded from the known-id sets: a persisted value is either a
 * canonical id or the free text typed into the "Other" box, and free text of
 * literally "other" must rehydrate into the text box, not the option.
 */
function knownIdsOf(options: readonly OnboardingOption[]): ReadonlySet<string> {
  return new Set(options.filter((option) => option.id !== OTHER_OPTION_ID).map((o) => o.id));
}

const PRIMARY_BUSINESS_TYPE_IDS = knownIdsOf(PRIMARY_BUSINESS_TYPES);
const ADDITIONAL_BUSINESS_TYPE_IDS = knownIdsOf(ADDITIONAL_BUSINESS_TYPES);
const PROGRAM_SERVICE_IDS = knownIdsOf(PROGRAM_SERVICES);

const SELECTABLE_PROGRAM_SERVICES = PROGRAM_SERVICES.filter(
  (service) => service.id !== OTHER_OPTION_ID,
);

function primaryBusinessTypeLabel(value: string | null): string {
  if (!value) return '';
  return (
    getOptionLabel(PRIMARY_BUSINESS_TYPES, value) ??
    LEGACY_PRIMARY_BUSINESS_TYPE_LABELS[value] ??
    value
  );
}

function optionLabels(options: readonly OnboardingOption[], values: string[]): string {
  return values.map((value) => getOptionLabel(options, value) ?? value).join(', ');
}

interface OrganizationFormValues {
  name: string;
  dba: string;
  ein: string;
  staffCount: string;
  primaryContact: string;
  primaryEmail: string;
  country: string;
  phone: string;
  address: string;
  zipCode: string;
  city: string;
  state: string;
  licenseNumber: string;
  hipaa: string;
  primaryBusinessType: string;
  primaryBusinessTypeOtherText: string;
  additionalBusinessTypes: string[];
  additionalBusinessTypeOtherText: string;
  programServices: string[];
  programServicesOtherText: string;
}

function toFormValues(organization: OrganizationSectionData): OrganizationFormValues {
  const primary = hydrateSingleSelection(
    organization.primaryBusinessType ?? undefined,
    PRIMARY_BUSINESS_TYPE_IDS,
  );
  const additional = hydrateSelection(
    organization.additionalBusinessTypes,
    ADDITIONAL_BUSINESS_TYPE_IDS,
  );
  const services = hydrateSelection(organization.programServices, PROGRAM_SERVICE_IDS);

  return {
    name: organization.name,
    dba: organization.dba ?? '',
    ein: organization.ein ?? '',
    staffCount: organization.staffCount ?? '',
    primaryContact: organization.primaryContact ?? '',
    primaryEmail: organization.primaryEmail ?? '',
    country: organization.country ?? '',
    phone: organization.phone ?? '',
    address: organization.address ?? '',
    zipCode: organization.zipCode ?? '',
    city: organization.city ?? '',
    state: organization.state ?? '',
    licenseNumber: organization.licenseNumber ?? '',
    hipaa: organization.isHipaaCompliant ? 'yes' : 'no',
    primaryBusinessType: primary.selectedId,
    primaryBusinessTypeOtherText: primary.otherText,
    additionalBusinessTypes: additional.selectedIds,
    additionalBusinessTypeOtherText: additional.otherText,
    programServices: services.selectedIds,
    programServicesOtherText: services.otherText,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function DocumentRow({
  document,
  onDelete,
  isDeleting,
}: {
  document: ComplianceDocument;
  onDelete?: () => void;
  isDeleting?: boolean;
}) {
  const extension = document.name.split('.').pop()?.toUpperCase() ?? 'FILE';

  return (
    <div className="flex items-center justify-between gap-4 rounded-[10px] border border-border px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        {document.displayUrl ? (
          <a
            href={document.displayUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold break-words text-foreground hover:text-primary hover:underline"
          >
            {document.name}
          </a>
        ) : (
          <span className="text-sm font-semibold break-words text-foreground">{document.name}</span>
        )}
        <span className="flex items-center gap-2 text-xs text-text-secondary">
          <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="font-medium">{extension}</span>
          <span>{formatFileSize(document.sizeBytes)}</span>
        </span>
      </div>
      {onDelete && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          loading={isDeleting}
          onClick={onDelete}
          aria-label={`Delete ${document.name}`}
          className="shrink-0 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export default function MyOrganizationSection({
  organization,
  complianceDocuments,
  canEdit,
}: MyOrganizationSectionProps) {
  const router = useRouter();
  const additionalTypesId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<OrganizationFormValues>({
    defaultValues: organization ? toFormValues(organization) : undefined,
  });

  const additionalTypes = useController({ name: 'additionalBusinessTypes', control });
  const additionalTypeOther = useController({
    name: 'additionalBusinessTypeOtherText',
    control,
  });

  // Re-seed after a save so a cancelled follow-up edit restores freshly saved
  // values rather than the ones this component first mounted with.
  useEffect(() => {
    if (organization) reset(toFormValues(organization));
  }, [organization, reset]);

  if (!organization) {
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

  const onSubmit = async (values: OrganizationFormValues) => {
    setMessage(null);

    const result = await updateOrganization({
      name: values.name.trim(),
      dba: values.dba.trim(),
      ein: values.ein.trim(),
      staffCount: values.staffCount,
      primaryContact: values.primaryContact.trim(),
      primaryEmail: values.primaryEmail.trim(),
      phone: values.phone.trim(),
      address: values.address.trim(),
      country: values.country,
      state: values.state,
      zipCode: values.zipCode.trim(),
      city: values.city.trim(),
      licenseNumber: values.licenseNumber.trim(),
      isHipaaCompliant: values.hipaa === 'yes',
      primaryBusinessType: resolveSingleSelection(
        values.primaryBusinessType,
        values.primaryBusinessTypeOtherText,
      ),
      additionalBusinessTypes: resolveSelection(
        values.additionalBusinessTypes,
        values.additionalBusinessTypeOtherText,
      ),
      programServices: resolveSelection(values.programServices, values.programServicesOtherText),
    });

    if (!result.success) {
      setMessage({ type: 'error', text: result.error ?? 'Failed to update organization' });
      return;
    }

    setMessage({ type: 'success', text: 'Organization updated successfully' });
    setIsEditing(false);
    router.refresh();
  };

  const handleDeleteDocument = async (documentId: string) => {
    setDeletingDocumentId(documentId);
    setMessage(null);
    try {
      const result = await deleteFacilityComplianceDocument(documentId);
      if (!result.success) {
        setMessage({ type: 'error', text: result.error ?? 'Failed to delete document' });
        return;
      }
      router.refresh();
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const isOtherPrimary = watch('primaryBusinessType') === OTHER_OPTION_ID;
  const isOtherService = watch('programServices')?.includes(OTHER_OPTION_ID);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold text-foreground">My Organization</h2>
      {isEditing ? (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              reset(toFormValues(organization));
              setMessage(null);
              setIsEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" form="my-organization-form" loading={isSubmitting}>
            Save
          </Button>
        </div>
      ) : (
        canEdit && (
          <Button
            variant="outline"
            type="button"
            className="gap-2"
            onClick={() => {
              setMessage(null);
              setIsEditing(true);
            }}
          >
            Edit
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        )
      )}
    </div>
  );

  if (!isEditing) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {message && <Alert variant={message.type}>{message.text}</Alert>}

        <PanelCard>
          <h3 className="mb-6 text-base font-semibold text-foreground">
            1. Basic Organization Information
          </h3>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <ReadField label="Legal Business Name" value={organization.name} />
            <ReadField label="Doing Business As (DBA)" value={organization.dba} />
            <ReadField label="Employer Identification Number (EIN)" value={organization.ein} />
            <ReadField
              label="Number of Staff"
              value={
                organization.staffCount
                  ? getLabeledOption(STAFF_COUNT_OPTIONS, organization.staffCount)
                  : null
              }
            />
            <ReadField label="Primary Contact Name" value={organization.primaryContact} />
            <ReadField label="Primary Contact Email" value={organization.primaryEmail} />
            <ReadField
              label="Country"
              value={
                organization.country
                  ? getLabeledOption(COUNTRY_OPTIONS, organization.country)
                  : null
              }
            />
            <ReadField label="Phone Number" value={organization.phone} />
            <ReadField label="Street Address" value={organization.address} />
            <ReadField label="Zip Code" value={organization.zipCode} />
            <ReadField label="City" value={organization.city} />
            <ReadField
              label="State"
              value={organization.state ? getLabeledOption(US_STATES, organization.state) : null}
            />
          </div>
        </PanelCard>

        <PanelCard>
          <h3 className="mb-6 text-base font-semibold text-foreground">
            2. Credentialing &amp; Documentation
          </h3>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <ReadField label="State Healthcare License Number" value={organization.licenseNumber} />
            <ReadField
              label="HIPAA Compliance Confirmation:"
              value={organization.isHipaaCompliant ? 'Yes' : 'No'}
            />
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <span className="text-sm text-text-secondary">Uploaded compliance certifications:</span>
            {complianceDocuments.length === 0 ? (
              <span className="text-base font-semibold text-foreground">{EM_DASH}</span>
            ) : (
              complianceDocuments.map((document) => (
                <DocumentRow key={document.id} document={document} />
              ))
            )}
          </div>
        </PanelCard>

        <PanelCard>
          <h3 className="mb-6 text-base font-semibold text-foreground">3. Organization Services</h3>
          <dl className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-6">
              <dt className="text-sm text-text-secondary">Primary Business Type</dt>
              <dd className="text-base font-semibold break-words text-foreground">
                {primaryBusinessTypeLabel(organization.primaryBusinessType) || EM_DASH}
              </dd>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-6">
              <dt className="text-sm text-text-secondary">Additional Business Type</dt>
              <dd className="text-base font-semibold break-words text-foreground">
                {optionLabels(ADDITIONAL_BUSINESS_TYPES, organization.additionalBusinessTypes) ||
                  EM_DASH}
              </dd>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-6">
              <dt className="text-sm text-text-secondary">Program Services</dt>
              <dd className="text-base font-semibold break-words text-foreground">
                {optionLabels(PROGRAM_SERVICES, organization.programServices) || EM_DASH}
              </dd>
            </div>
          </dl>
        </PanelCard>

        {/* Not in the Figma mock, but the join code is a live feature with no
            other home — dropping it would take the flow away entirely. */}
        <PanelCard>
          <h3 className="mb-2 text-base font-semibold text-foreground">Worker Onboarding</h3>
          <p className="mb-4 text-sm text-text-secondary">
            Share this join code with your workers so they can attach themselves to this
            organization.
          </p>
          <div className="max-w-md">
            <OrgCodeGenerator />
          </div>
        </PanelCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      {message && <Alert variant={message.type}>{message.text}</Alert>}

      <form
        id="my-organization-form"
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-8"
      >
        <section className="flex flex-col gap-6">
          <h3 className={sectionHeadingClass}>1. Basic Organization Information</h3>

          <Field label="Legal Business Name" required error={errors.name?.message}>
            <Input
              placeholder="e.g. Acme Healthcare Ltd"
              {...register('name', { required: 'Legal business name is required' })}
            />
          </Field>

          <Field label="Doing Business As (DBA)">
            <Input placeholder="Enter business name (if applicable)" {...register('dba')} />
          </Field>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Employer Identification Number (EIN)">
              <Input placeholder="XX-XXXXXXX" {...register('ein')} />
            </Field>
            <Controller
              name="staffCount"
              control={control}
              render={({ field }) => (
                <Field label="Number of Staff">
                  <Select
                    value={field.value || undefined}
                    onValueChange={(value) => value && field.onChange(value)}
                  >
                    <SelectTrigger className="h-14 w-full rounded-[10px]">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {STAFF_COUNT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Primary Contact Name">
              <Input
                placeholder="Enter the full name of the main contact"
                {...register('primaryContact')}
              />
            </Field>
            <Field label="Primary Contact Email" error={errors.primaryEmail?.message}>
              <Input
                type="email"
                placeholder="Enter the email address of the main contact"
                {...register('primaryEmail', {
                  validate: (value) =>
                    !value.trim() || EMAIL_PATTERN.test(value.trim()) || 'Enter a valid email',
                })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Controller
              name="country"
              control={control}
              render={({ field }) => (
                <Field label="Country">
                  <Select
                    value={field.value || undefined}
                    onValueChange={(value) => value && field.onChange(value)}
                  >
                    <SelectTrigger className="h-14 w-full rounded-[10px]">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            {/* PhoneInput owns its own composite markup and takes no `id`, so
                the label is a plain one — matching onboarding step 1. */}
            <div className="flex w-full flex-col gap-1.5">
              <Label>Phone Number</Label>
              <Controller
                name="phone"
                control={control}
                render={({ field }) => (
                  <PhoneInput
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Enter the phone number of the main contact"
                    allowedCountries={['US']}
                  />
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Street Address">
              <Input placeholder="Enter business street address" {...register('address')} />
            </Field>
            <Field label="Zip Code">
              <Input placeholder="e.g. 27601" {...register('zipCode')} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="City">
              <Input placeholder="Enter city" {...register('city')} />
            </Field>
            <Controller
              name="state"
              control={control}
              render={({ field }) => (
                <Field label="State">
                  <Select
                    value={field.value || undefined}
                    onValueChange={(value) => value && field.onChange(value)}
                  >
                    <SelectTrigger className="h-14 w-full rounded-[10px]">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <h3 className={sectionHeadingClass}>2. Credentialing &amp; Documentation</h3>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="State Healthcare License Number">
              <Input
                placeholder="Enter your official license number"
                {...register('licenseNumber')}
              />
            </Field>
            <Controller
              name="hipaa"
              control={control}
              render={({ field }) => (
                <Field label="HIPAA Compliance Confirmation:">
                  <Select
                    value={field.value || undefined}
                    onValueChange={(value) => value && field.onChange(value)}
                  >
                    <SelectTrigger className="h-14 w-full rounded-[10px]">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {HIPAA_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium text-foreground">
              Uploaded compliance certifications:
            </span>
            {complianceDocuments.length === 0 ? (
              <p className="text-sm text-text-secondary">No certifications uploaded yet.</p>
            ) : (
              complianceDocuments.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  isDeleting={deletingDocumentId === document.id}
                  onDelete={() => handleDeleteDocument(document.id)}
                />
              ))
            )}
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <h3 className={sectionHeadingClass}>3. Organization Services</h3>

          <Controller
            name="primaryBusinessType"
            control={control}
            render={({ field }) => (
              <Field label="Primary Business Type">
                <Select
                  value={field.value || undefined}
                  onValueChange={(value) => value && field.onChange(value)}
                >
                  <SelectTrigger className="h-14 w-full rounded-[10px]">
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

          {isOtherPrimary && (
            <Field
              label="Specify your business type"
              error={errors.primaryBusinessTypeOtherText?.message}
            >
              <Input
                placeholder="Please specify"
                {...register('primaryBusinessTypeOtherText', {
                  validate: (value, formValues) =>
                    formValues.primaryBusinessType !== OTHER_OPTION_ID ||
                    value.trim().length > 0 ||
                    'Please specify your business type',
                })}
              />
            </Field>
          )}

          <div className="flex w-full flex-col gap-1.5">
            <Label htmlFor={additionalTypesId}>Additional Business Type</Label>
            <OptionChipSelect
              id={additionalTypesId}
              aria-label="Additional Business Type"
              options={ADDITIONAL_BUSINESS_TYPES}
              value={additionalTypes.field.value}
              onChange={additionalTypes.field.onChange}
              otherText={additionalTypeOther.field.value}
              onOtherTextChange={additionalTypeOther.field.onChange}
            />
          </div>

          <Controller
            name="programServices"
            control={control}
            render={({ field }) => (
              <div className="flex flex-col gap-4">
                <span className="text-sm font-medium text-foreground">Program Services</span>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {SELECTABLE_PROGRAM_SERVICES.map((service) => (
                    <label
                      key={service.id}
                      className="flex min-w-0 cursor-pointer items-center gap-3"
                    >
                      <Checkbox
                        className="size-5 rounded-[5px]"
                        checked={field.value.includes(service.id)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked === true
                              ? [...field.value, service.id]
                              : field.value.filter((id: string) => id !== service.id),
                          )
                        }
                      />
                      <span className="min-w-0 text-sm break-words text-foreground">
                        {service.label}
                      </span>
                    </label>
                  ))}
                  <label className="flex min-w-0 cursor-pointer items-center gap-3">
                    <Checkbox
                      className="size-5 rounded-[5px]"
                      checked={field.value.includes(OTHER_OPTION_ID)}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked === true
                            ? [...field.value, OTHER_OPTION_ID]
                            : field.value.filter((id: string) => id !== OTHER_OPTION_ID),
                        )
                      }
                    />
                    <span className="min-w-0 text-sm break-words text-foreground">
                      Other (specify)
                    </span>
                  </label>
                </div>
              </div>
            )}
          />

          {isOtherService && (
            <Field
              label="Specify the program service"
              error={errors.programServicesOtherText?.message}
            >
              <Input
                placeholder="Please specify"
                {...register('programServicesOtherText', {
                  validate: (value, formValues) =>
                    !formValues.programServices.includes(OTHER_OPTION_ID) ||
                    value.trim().length > 0 ||
                    'Please specify the program service',
                })}
              />
            </Field>
          )}
        </section>
      </form>
    </div>
  );
}
