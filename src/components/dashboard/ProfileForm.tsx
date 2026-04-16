'use client';

import React, { useState, useRef } from 'react';
import styles from './ProfileForm.module.css';
import { Button, Input, Modal } from '@/components/ui';
import { updateProfile, uploadAvatar } from '@/app/actions/user';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import OrganizationForm from './OrganizationForm';

interface ProfileData {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: 'admin' | 'worker';
  jobTitle?: string;
  company_name?: string;
  avatarUrl?: string | null;
  avatarDisplayUrl?: string | null;
}

interface OrganizationData {
  id: string;
  name: string;
  dba?: string | null;
  ein?: string | null;
  staffCount?: string | null;
  primaryContact?: string | null;
  primaryEmail?: string | null;
  phone?: string | null;
  address?: string | null;
  country?: string | null;
  state?: string | null;
  zipCode?: string | null;
  city?: string | null;
  licenseNumber?: string | null;
  isHipaaCompliant?: boolean;
}

interface ProfileFormProps {
  initialData: ProfileData;
  organizationData?: OrganizationData | null;
}

export default function ProfileForm({ initialData, organizationData }: ProfileFormProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'organization'>('profile');
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

  const isAdmin = initialData.role === 'admin';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link href="/dashboard" className={styles.backLink}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Back to dashboard
        </Link>
      </div>

      <div className={styles.card}>
        <div className={styles.tabs}>
          <div
            className={`${styles.tab} ${activeTab === 'profile' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            EDIT PROFILE
          </div>
          <div
            className={`${styles.tab} ${activeTab === 'organization' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('organization')}
          >
            YOUR ORGANIZATION
          </div>
        </div>

        {activeTab === 'profile' ? (
          <div className={styles.profileWrapper}>
            <div className={styles.avatarSection}>
              <div className={styles.avatarLarge}>
                {avatarDisplayUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarDisplayUrl}
                    alt="Profile Avatar"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      borderRadius: '50%',
                    }}
                  />
                ) : formData.first_name ? (
                  formData.first_name[0].toUpperCase()
                ) : (
                  'U'
                )}
                <Button
                  variant="primary"
                  size="icon-sm"
                  className={styles.editAvatarButton}
                  type="button"
                  onClick={handleAvatarClick}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                  </svg>
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  style={{ display: 'none' }}
                />
              </div>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.formGrid}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>First Name</label>
                  <Input
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    placeholder="Jane"
                    error={!formData.first_name.trim() ? 'First name is required' : undefined}
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Last Name</label>
                  <Input
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    placeholder="Doe"
                    error={!formData.last_name.trim() ? 'Last name is required' : undefined}
                  />
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Company</label>
                <Input
                  name="company_name"
                  value={organizationData?.name || formData.company_name || ''}
                  onChange={isAdmin ? handleChange : undefined}
                  disabled={!isAdmin}
                  className={!isAdmin ? styles.readOnlyInput : undefined}
                  placeholder="Your company name"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Email Address</label>
                <Input
                  name="email"
                  value={formData.email}
                  disabled
                  className={styles.readOnlyInput}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Job Title</label>
                <Input
                  name="jobTitle"
                  value={formData.jobTitle || ''}
                  onChange={handleChange}
                  placeholder="e.g. Compliance Officer"
                />
              </div>

              {/* Country & Phone */}
              <div className={styles.formGrid}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Country</label>
                  <Input
                    value={organizationData?.country || ''}
                    disabled
                    className={styles.readOnlyInput}
                    placeholder="Your country"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Phone</label>
                  <Input
                    value={organizationData?.phone || ''}
                    disabled
                    className={styles.readOnlyInput}
                    placeholder="Your phone number"
                  />
                </div>
              </div>

              {/* Business Address */}
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Business Address</label>
                <Input
                  value={organizationData?.address || ''}
                  disabled
                  className={styles.readOnlyInput}
                  placeholder="Your business address"
                />
              </div>

              {/* City, State & Zip Code */}
              <div className={styles.formGrid}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>City</label>
                  <Input
                    value={organizationData?.city || ''}
                    disabled
                    className={styles.readOnlyInput}
                    placeholder="Your city"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>State</label>
                  <Input
                    value={organizationData?.state || ''}
                    disabled
                    className={styles.readOnlyInput}
                    placeholder="Your state"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Zip Code</label>
                  <Input
                    value={organizationData?.zipCode || ''}
                    disabled
                    className={styles.readOnlyInput}
                    placeholder="Your zip code"
                  />
                </div>
              </div>

              {message && (
                <div className={`${styles.message} ${styles[message.type]}`}>{message.text}</div>
              )}

              {isDirty && (
                <div className={styles.actions}>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setFormData({ ...baseData });
                      setAvatarUrl(baseAvatarUrl);
                      setAvatarDisplayUrl(initialData.avatarDisplayUrl || null);
                    }}
                    className={styles.discardButton}
                    disabled={isLoading}
                  >
                    Discard
                  </Button>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={!isValid || isLoading}
                    className={styles.saveButton}
                  >
                    {isLoading ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        ) : (
          <OrganizationForm initialData={organizationData || null} isAdmin={isAdmin} />
        )}
      </div>

      {/* Confirmation Modal */}
      <Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)}>
        <div className={styles.modalContent}>
          <div className={styles.modalIcon}>
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h3 className={styles.modalTitle}>Confirm profile update</h3>
          <p className={styles.modalText}>
            Are you sure you want to make these changes to your profile?
          </p>
          <div className={styles.modalActions}>
            <Button
              variant="secondary"
              onClick={() => setShowConfirm(false)}
              className={styles.modalCancel}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmSave} className={styles.modalConfirm}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
