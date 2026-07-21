'use client';

import React, { useState, useRef } from 'react';
import { ArrowLeft, Check, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Alert } from '@/components/ui';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updateProfile, uploadAvatar } from '@/app/actions/user';
import { isAdminRole } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import OrganizationForm from './OrganizationForm';
import FacilityForm from './FacilityForm';
import { ChangePasswordTab } from './ChangePasswordTab';
import { TwoFactorAuthTab } from './TwoFactorAuthTab';

interface ProfileData {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  jobTitle?: string;
  company_name?: string;
  avatarUrl?: string | null;
  avatarDisplayUrl?: string | null;
  authProvider?: string;
}

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
  timezone?: string | null;
  licenseNumber?: string | null;
  programServices?: string[];
  complianceDocumentUrl?: string | null;
  complianceDocumentName?: string | null;
  complianceDocumentDisplayUrl?: string | null;
}

interface ProfileFormProps {
  initialData: ProfileData;
  organizationData?: OrganizationData | null;
  facilityData?: FacilityData | null;
  canReadFacility?: boolean;
}

type TabKey = 'profile' | 'organization' | 'facility' | 'password' | '2fa';

export default function ProfileForm({
  initialData,
  organizationData,
  facilityData,
  canReadFacility = false,
}: ProfileFormProps) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'profile', label: 'EDIT PROFILE' },
    { key: 'organization', label: 'YOUR ORGANIZATION' },
    ...(canReadFacility ? [{ key: 'facility' as const, label: 'YOUR FACILITY' }] : []),
    { key: 'password', label: 'CHANGE PASSWORD' },
    { key: '2fa', label: 'TWO FACTOR AUTH (2FA)' },
  ];
  const [activeTab, setActiveTab] = useState<TabKey>('profile');
  const [baseData, setBaseData] = useState(initialData);
  const [formData, setFormData] = useState(initialData);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialData.avatarUrl || null);
  const [avatarDisplayUrl, setAvatarDisplayUrl] = useState<string | null>(
    initialData.avatarDisplayUrl || null,
  );
  const [baseAvatarUrl, setBaseAvatarUrl] = useState<string | null>(initialData.avatarUrl || null);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  React.useEffect(() => {
    setFormData(initialData);
    setBaseData(initialData);
    setAvatarUrl(initialData.avatarUrl || null);
    setAvatarDisplayUrl(initialData.avatarDisplayUrl || null);
    setBaseAvatarUrl(initialData.avatarUrl || null);
  }, [initialData]);

  React.useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const isDirty =
    formData.first_name !== baseData.first_name ||
    formData.last_name !== baseData.last_name ||
    formData.role !== baseData.role ||
    formData.jobTitle !== baseData.jobTitle ||
    (formData.company_name || '') !== (baseData.company_name || '') ||
    avatarUrl !== baseAvatarUrl;

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Instant local preview
    const localPreviewUrl = URL.createObjectURL(file);
    setAvatarDisplayUrl(localPreviewUrl);

    setIsLoading(true);
    const data = new FormData();
    data.append('file', file);

    try {
      const result = await uploadAvatar(data);
      if (result.success && result.url) {
        setAvatarUrl(result.url);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to upload avatar' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Upload failed' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setShowConfirm(true);
  };

  const handleConfirmSave = async () => {
    setShowConfirm(false);
    setIsLoading(true);

    try {
      const result = await updateProfile({
        first_name: formData.first_name,
        last_name: formData.last_name,
        company_name: formData.company_name,
        jobTitle: formData.jobTitle || undefined,
        avatarUrl: avatarUrl || undefined,
      });

      if (!result.success) throw new Error(result.error);

      setMessage({ type: 'success', text: 'Profile updated successfully' });
      setBaseData(formData);
      setBaseAvatarUrl(avatarUrl);
      router.refresh();
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({ type: 'error', text: err.message || 'Failed to update profile' });
    } finally {
      setIsLoading(false);
    }
  };

  const isValid = formData.first_name?.trim() !== '' && formData.last_name?.trim() !== '';
  // Email is read-only, so we won't block saving if it's missing/invalid from the DB side,
  // though it ideally should be there.

  const isAdmin = isAdminRole(initialData.role);

  return (
    <div className="flex min-h-[calc(100vh-100px)] flex-col items-center justify-center p-6">
      <div className="mb-6 w-full max-w-[900px]">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>

      <div className="flex min-h-[600px] w-full max-w-[900px] flex-col overflow-hidden rounded-xl border border-border bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
        <div className="px-6 sm:px-10">
          <div className="flex items-center gap-8 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`relative -bottom-px shrink-0 cursor-pointer border-b-2 px-1 py-3 text-[13px] font-semibold whitespace-nowrap uppercase tracking-[0.05em] transition-all ${
                  activeTab === tab.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'profile' && (
          <div className="flex flex-col items-center gap-8 p-6 md:flex-row md:items-start md:gap-16 md:p-10">
            <div className="flex w-auto shrink-0 justify-center pt-2 md:w-[120px]">
              <div className="relative flex size-[120px] items-center justify-center rounded-full bg-background-secondary text-[48px] font-semibold text-text-secondary shadow-md">
                {avatarDisplayUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarDisplayUrl}
                    alt="Profile Avatar"
                    className="size-full rounded-full object-cover"
                  />
                ) : formData.first_name || formData.last_name ? (
                  `${formData.first_name?.[0] || ''}${formData.last_name?.[0] || ''}`.toUpperCase()
                ) : (
                  'U'
                )}
                <Button
                  size="icon-sm"
                  className="absolute right-0 bottom-0 size-8 rounded-full border-[3px] border-white"
                  type="button"
                  onClick={handleAvatarClick}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="flex max-w-[800px] flex-1 flex-col">
              <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Field
                  label="First Name"
                  error={!formData.first_name.trim() ? 'First name is required' : undefined}
                >
                  <Input
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    placeholder="Jane"
                  />
                </Field>
                <Field
                  label="Last Name"
                  error={!formData.last_name.trim() ? 'Last name is required' : undefined}
                >
                  <Input
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    placeholder="Doe"
                  />
                </Field>
              </div>

              <div className="mb-6">
                <Field label="Company">
                  <Input
                    name="company_name"
                    value={organizationData?.name || formData.company_name || ''}
                    onChange={isAdmin ? handleChange : undefined}
                    disabled={!isAdmin}
                    placeholder="Your company name"
                  />
                </Field>
              </div>

              <div className="mb-6">
                <Field label="Email Address">
                  <Input name="email" value={formData.email} disabled />
                </Field>
              </div>

              <div className="mb-6">
                <Field label="Job Title">
                  <Input
                    name="jobTitle"
                    value={formData.jobTitle || ''}
                    onChange={handleChange}
                    placeholder="e.g. Compliance Officer"
                  />
                </Field>
              </div>

              {/* Country & Phone (facility location, read-only here) */}
              <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Field label="Country">
                  <Input value={facilityData?.country || ''} disabled placeholder="Your country" />
                </Field>
                <Field label="Phone">
                  <Input
                    value={facilityData?.phone || ''}
                    disabled
                    placeholder="Your phone number"
                  />
                </Field>
              </div>

              <div className="mb-6">
                <Field label="Business Address">
                  <Input
                    value={facilityData?.address || ''}
                    disabled
                    placeholder="Your business address"
                  />
                </Field>
              </div>

              <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
                <Field label="City">
                  <Input value={facilityData?.city || ''} disabled placeholder="Your city" />
                </Field>
                <Field label="State">
                  <Input value={facilityData?.state || ''} disabled placeholder="Your state" />
                </Field>
                <Field label="Zip Code">
                  <Input value={facilityData?.zipCode || ''} disabled placeholder="Your zip code" />
                </Field>
              </div>

              {message && (
                <Alert variant={message.type} className="mb-6">
                  {message.text}
                </Alert>
              )}

              {isDirty && (
                <div className="mt-8 flex justify-end gap-4">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setFormData({ ...baseData });
                      setAvatarUrl(baseAvatarUrl);
                      setAvatarDisplayUrl(initialData.avatarDisplayUrl || null);
                    }}
                    className="border-primary text-primary"
                    disabled={isLoading}
                  >
                    Discard
                  </Button>
                  <Button
                    type="submit"
                    disabled={!isValid || isLoading}
                    loading={isLoading}
                    className="min-w-[140px]"
                  >
                    Save Changes
                  </Button>
                </div>
              )}
            </form>
          </div>
        )}

        {activeTab === 'organization' && (
          <OrganizationForm initialData={organizationData || null} isAdmin={isAdmin} />
        )}

        {activeTab === 'facility' && canReadFacility && (
          <FacilityForm initialData={facilityData || null} />
        )}

        {activeTab === 'password' && <ChangePasswordTab authProvider={initialData.authProvider} />}

        {activeTab === '2fa' && <TwoFactorAuthTab userEmail={initialData.email} />}
      </div>

      <Dialog
        open={showConfirm}
        onOpenChange={(open) => {
          if (!open) setShowConfirm(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="items-center text-center sm:text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success/10 text-success">
              <Check className="size-8" strokeWidth={3} aria-hidden="true" />
            </div>
            <DialogTitle className="text-center text-xl">Confirm profile update</DialogTitle>
          </DialogHeader>
          <p className="text-center leading-relaxed text-text-secondary">
            Are you sure you want to make these changes to your profile?
          </p>
          <DialogFooter className="justify-center sm:justify-center">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setShowConfirm(false)}
              className="min-w-[100px]"
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirmSave} className="min-w-[100px]">
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
