'use client';

import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Alert } from '@/components/ui/alert';
import { updateProfile, uploadAvatar } from '@/app/actions/user';
import { useRouter } from 'next/navigation';
import ProfileSettingsShell from '../dashboard/profile/ProfileSettingsShell';
import { ChangePasswordTab } from '../dashboard/ChangePasswordTab';
import { TwoFactorAuthTab } from '../dashboard/TwoFactorAuthTab';

interface WorkerProfileProps {
  user: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: string;
    jobTitle?: string | null;
    avatarUrl?: string | null;
    avatarDisplayUrl?: string | null;
    authProvider?: string;
  };
  organization?: {
    name: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
  } | null;
}

const inputCls =
  'h-10 w-full rounded-md border border-[#e2e8f0] bg-white px-3 text-sm text-[#1a202c] transition-all outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_2px_rgba(37,99,235,0.1)]';
const readOnlyCls = 'cursor-not-allowed border-[#e2e8f0] bg-[#f7fafc] text-[#718096]';
const labelCls = 'mb-2 block text-sm font-semibold text-[#1a202c]';

export default function WorkerProfileForm({ user, organization }: WorkerProfileProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'profile' | 'password' | '2fa'>('profile');
  const [formData, setFormData] = useState({
    first_name: user.first_name,
    last_name: user.last_name,
    jobTitle: user.jobTitle || '',
  });
  const [baseData, setBaseData] = useState({
    first_name: user.first_name,
    last_name: user.last_name,
    jobTitle: user.jobTitle || '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  React.useEffect(() => {
    setFormData({
      first_name: user.first_name,
      last_name: user.last_name,
      jobTitle: user.jobTitle || '',
    });
    setBaseData({
      first_name: user.first_name,
      last_name: user.last_name,
      jobTitle: user.jobTitle || '',
    });
    setAvatarUrl(user.avatarUrl || null);
    setAvatarDisplayUrl(user.avatarDisplayUrl || null);
    setBaseAvatarUrl(user.avatarUrl || null);
  }, [user]);

  const [showConfirm, setShowConfirm] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl || null);
  const [avatarDisplayUrl, setAvatarDisplayUrl] = useState<string | null>(
    user.avatarDisplayUrl || null,
  );
  const [baseAvatarUrl, setBaseAvatarUrl] = useState<string | null>(user.avatarUrl || null);

  const isDirty =
    formData.first_name !== baseData.first_name ||
    formData.last_name !== baseData.last_name ||
    formData.jobTitle !== baseData.jobTitle ||
    avatarUrl !== baseAvatarUrl;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.first_name.trim()) {
      newErrors.first_name = 'First name is required';
    }

    if (!formData.last_name.trim()) {
      newErrors.last_name = 'Last name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setShowConfirm(true);
  };

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
        // We don't save immediately, we wait for "Save Changes"
        // But we should probably mark as dirty (which we did by adding avatarUrl to check)
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to upload avatar' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Upload failed' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmSave = async () => {
    setShowConfirm(false);
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await updateProfile({
        first_name: formData.first_name,
        last_name: formData.last_name,
        jobTitle: formData.jobTitle || undefined,
        avatarUrl: avatarUrl || undefined,
        // Worker cannot update company name, so we don't send it or send empty
      });

      if (result.success) {
        setMessage({ type: 'success', text: 'Profile updated successfully' });
        setBaseData({ ...formData });
        setBaseAvatarUrl(avatarUrl);
        router.refresh();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update profile' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  const businessAddress = organization
    ? `${organization.address || ''}, ${organization.city || ''}`
        .replace(/^, /, '')
        .replace(/, $/, '')
    : '';

  const tabs = [
    { key: 'profile' as const, label: 'My Profile' },
    { key: 'password' as const, label: 'Change Password' },
    { key: '2fa' as const, label: 'Two-factor Authentication' },
  ];

  return (
    <ProfileSettingsShell
      backHref="/worker"
      navItems={tabs}
      activeKey={activeTab}
      onSelect={setActiveTab}
    >
      <>
        {activeTab === 'profile' && (
          <div className="flex items-start gap-16 max-md:flex-col max-md:items-center max-md:gap-8 max-[480px]:gap-5">
            <div className="flex w-30 flex-shrink-0 justify-center pt-2 max-md:w-auto">
              <div className="relative flex size-30 items-center justify-center rounded-full bg-[#e2e8f0] text-5xl font-semibold text-[#64748b] shadow-md max-[480px]:size-20 max-[480px]:text-[32px]">
                {avatarDisplayUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarDisplayUrl}
                    alt="Profile"
                    className="size-full rounded-full object-cover"
                  />
                ) : (
                  <span>
                    {`${formData.first_name?.[0] || ''}${formData.last_name?.[0] || ''}`.toUpperCase() ||
                      user.email[0].toUpperCase()}
                  </span>
                )}
                <button
                  className="absolute bottom-0 right-0 flex size-8 items-center justify-center rounded-full border-[3px] border-white bg-[#2563eb] text-white shadow-sm transition-all hover:scale-110 hover:bg-[#1d4ed8]"
                  title="Change Avatar"
                  type="button"
                  onClick={handleAvatarClick}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                </button>
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
              <div className="mb-6 grid grid-cols-2 gap-6 max-md:grid-cols-1">
                <div className="mb-6">
                  <label className={labelCls}>First Name</label>
                  <input
                    className={inputCls}
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    placeholder="First Name"
                  />
                  {errors.first_name && (
                    <span className="mt-1 block text-[13px] text-[#E53E3E]">
                      {errors.first_name}
                    </span>
                  )}
                </div>
                <div className="mb-6">
                  <label className={labelCls}>Last Name</label>
                  <input
                    className={inputCls}
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    placeholder="Last Name"
                  />
                  {errors.last_name && (
                    <span className="mt-1 block text-[13px] text-[#E53E3E]">
                      {errors.last_name}
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <label className={labelCls}>Company</label>
                <input
                  className={`${inputCls} ${readOnlyCls}`}
                  value={organization?.name || ''}
                  disabled
                  placeholder="Company Name"
                />
              </div>

              <div className="mb-6">
                <label className={labelCls}>Email Address</label>
                <input className={`${inputCls} ${readOnlyCls}`} value={user.email} disabled />
              </div>

              <div className="mb-6">
                <label className={labelCls}>Job Title</label>
                <input
                  name="jobTitle"
                  className={inputCls}
                  value={formData.jobTitle || ''}
                  onChange={handleChange}
                  placeholder="e.g. Caregiver"
                />
              </div>

              <div className="mb-6 grid grid-cols-2 gap-6 max-md:grid-cols-1">
                <div className="mb-6">
                  <label className={labelCls}>State</label>
                  <input
                    className={`${inputCls} ${readOnlyCls}`}
                    value={organization?.state || ''}
                    disabled
                    placeholder="State"
                  />
                </div>
                <div className="mb-6">
                  <label className={labelCls}>Zip Code</label>
                  <input
                    className={`${inputCls} ${readOnlyCls}`}
                    value={organization?.zipCode || ''}
                    disabled
                    placeholder="Zip Code"
                  />
                </div>
              </div>

              <div className="mb-6">
                <label className={labelCls}>Business Address</label>
                <input
                  className={`${inputCls} ${readOnlyCls}`}
                  value={businessAddress}
                  disabled
                  placeholder="Business Address"
                />
              </div>

              {message && (
                <div className="mb-6">
                  <Alert variant={message.type}>{message.text}</Alert>
                </div>
              )}

              <div className="mt-8 flex justify-end gap-4 max-[480px]:flex-col">
                <Button type="submit" loading={isLoading} disabled={!isDirty}>
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'password' && (
          <div className="flex flex-col gap-6">
            <h2 className="text-xl font-semibold text-foreground">Change Password</h2>
            <ChangePasswordTab authProvider={user.authProvider} />
          </div>
        )}

        {activeTab === '2fa' && (
          <div className="flex flex-col gap-6">
            <h2 className="text-xl font-semibold text-foreground">Two-factor Authentication</h2>
            <TwoFactorAuthTab userEmail={user.email} />
          </div>
        )}
      </>

      <Dialog
        open={showConfirm}
        onOpenChange={(open) => {
          if (!open) setShowConfirm(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="items-center text-center">
            <DialogTitle>Confirm Changes</DialogTitle>
            <DialogDescription>Are you sure you want to update your profile?</DialogDescription>
          </DialogHeader>
          <DialogFooter className="justify-center sm:justify-center">
            <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleConfirmSave} loading={isLoading}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProfileSettingsShell>
  );
}
