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
import { actionButtonClass, fieldClass } from './profile-tab-styles';

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
    { key: 'profile', label: 'PROFILE' },
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
    <div className="flex flex-col pb-16">
      <div className="flex px-6 pt-7 lg:px-[107px] lg:pt-[51px]">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-[11px] text-base leading-[22px] font-medium text-foreground hover:text-primary"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>

      <div className="mx-auto mt-7 w-full max-w-[960px] px-6 lg:mt-[42px] lg:px-0">
        <div
          role="tablist"
          className="flex items-center gap-[10px] overflow-x-auto border-b-[1.114px] border-[#ebedf0] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="relative flex h-[43px] shrink-0 cursor-pointer flex-col items-center px-[10px]"
            >
              <span
                className={`flex shrink-0 items-center justify-center rounded-[6.682px] px-[17.818px] py-[8.909px] text-[15.591px] leading-[22.273px] font-semibold tracking-[1.5591px] whitespace-nowrap transition-colors ${
                  activeTab === tab.key ? 'text-[#1e293b]' : 'text-[#64748b] hover:text-[#1e293b]'
                }`}
              >
                {tab.label}
              </span>
              {activeTab === tab.key && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-[10px] bottom-[-1.114px] h-[3.341px] rounded-t-[4.455px] bg-[#2e70e8]"
                />
              )}
            </button>
          ))}
        </div>

        <div className="mt-7 lg:mt-[42px] lg:px-5">
          {activeTab === 'profile' && (
            <div className="flex flex-col items-start gap-8 md:flex-row">
              <div className="relative w-[125px] shrink-0">
                <div className="flex size-[121.68px] items-center justify-center overflow-hidden rounded-full bg-background-secondary text-[48px] font-semibold text-text-secondary">
                  {avatarDisplayUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarDisplayUrl}
                      alt="Profile Avatar"
                      className="size-full object-cover"
                    />
                  ) : formData.first_name || formData.last_name ? (
                    `${formData.first_name?.[0] || ''}${formData.last_name?.[0] || ''}`.toUpperCase()
                  ) : (
                    'U'
                  )}
                </div>
                <Button
                  size="icon-sm"
                  className="absolute top-[79.65px] left-[97.35px] size-[27.655px] rounded-full"
                  type="button"
                  onClick={handleAvatarClick}
                  aria-label="Change profile photo"
                >
                  <Pencil className="size-[13.27px]" aria-hidden="true" />
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                />
              </div>

              <form
                onSubmit={handleSubmit}
                className="flex w-full min-w-0 flex-1 flex-col gap-[27.639px]"
              >
                <div className="grid grid-cols-1 gap-[16.584px] sm:grid-cols-2">
                  <Field
                    className={fieldClass}
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
                    className={fieldClass}
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

                <Field className={fieldClass} label="Company">
                  <Input
                    name="company_name"
                    value={organizationData?.name || formData.company_name || ''}
                    onChange={isAdmin ? handleChange : undefined}
                    disabled={!isAdmin}
                    placeholder="Your company name"
                  />
                </Field>

                <Field className={fieldClass} label="Email Address">
                  <Input name="email" value={formData.email} disabled />
                </Field>

                <Field className={fieldClass} label="Job Title">
                  <Input
                    name="jobTitle"
                    value={formData.jobTitle || ''}
                    onChange={handleChange}
                    placeholder="e.g. Compliance Officer"
                  />
                </Field>

                {/* Country & Phone (facility location, read-only here) */}
                <div className="grid grid-cols-1 gap-[16.584px] sm:grid-cols-2">
                  <Field className={fieldClass} label="Country">
                    <Input
                      value={facilityData?.country || ''}
                      disabled
                      placeholder="Your country"
                    />
                  </Field>
                  <Field className={fieldClass} label="Phone">
                    <Input
                      value={facilityData?.phone || ''}
                      disabled
                      placeholder="Your phone number"
                    />
                  </Field>
                </div>

                <Field className={fieldClass} label="Business Address">
                  <Input
                    value={facilityData?.address || ''}
                    disabled
                    placeholder="Your business address"
                  />
                </Field>

                <div className="grid grid-cols-1 gap-[16.584px] sm:grid-cols-3">
                  <Field className={fieldClass} label="City">
                    <Input value={facilityData?.city || ''} disabled placeholder="Your city" />
                  </Field>
                  <Field className={fieldClass} label="State">
                    <Input value={facilityData?.state || ''} disabled placeholder="Your state" />
                  </Field>
                  <Field className={fieldClass} label="Zip Code">
                    <Input
                      value={facilityData?.zipCode || ''}
                      disabled
                      placeholder="Your zip code"
                    />
                  </Field>
                </div>

                {message && <Alert variant={message.type}>{message.text}</Alert>}

                <div className="mt-[4.361px] flex justify-end gap-4">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setFormData({ ...baseData });
                      setAvatarUrl(baseAvatarUrl);
                      setAvatarDisplayUrl(initialData.avatarDisplayUrl || null);
                    }}
                    className={`${actionButtonClass} text-primary hover:bg-primary/5`}
                    disabled={isLoading}
                  >
                    Discard
                  </Button>
                  <Button
                    type="submit"
                    disabled={!isValid || !isDirty || isLoading}
                    loading={isLoading}
                    className={actionButtonClass}
                  >
                    Save Changes
                  </Button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'organization' && (
            <OrganizationForm initialData={organizationData || null} isAdmin={isAdmin} />
          )}

          {activeTab === 'facility' && canReadFacility && (
            <FacilityForm initialData={facilityData || null} />
          )}

          {activeTab === 'password' && (
            <ChangePasswordTab authProvider={initialData.authProvider} />
          )}

          {activeTab === '2fa' && <TwoFactorAuthTab userEmail={initialData.email} />}
        </div>
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
