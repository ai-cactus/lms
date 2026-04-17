'use client';

import React, { useState } from 'react';
import styles from './WorkerProfile.module.css';
import { Button, Modal } from '@/components/ui';
import { updateProfile, uploadAvatar } from '@/app/actions/user';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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
  };
  organization?: {
    name: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
  } | null;
}

export default function WorkerProfileForm({ user, organization }: WorkerProfileProps) {
  const router = useRouter();
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

  // DEBUG: Client-side mount check
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
    // Clear field error when user types
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

  return (
    <div className={styles.container}>
      <Link href="/worker" className={styles.backLink}>
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

      <div className={styles.card}>
        <div className={styles.profileWrapper}>
          <div className={styles.avatarSection}>
            <div className={styles.avatarLarge}>
              {avatarDisplayUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarDisplayUrl}
                  alt="Profile"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                />
              ) : (
                <span>{formData.first_name?.[0] || user.email[0].toUpperCase()}</span>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className={styles.editAvatarBtn}
                title="Change Avatar"
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
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
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
                <input
                  className={styles.input}
                  name="first_name"
                  value={formData.first_name}
                  onChange={handleChange}
                  placeholder="First Name"
                />
                {errors.first_name && (
                  <span
                    style={{
                      color: '#E53E3E',
                      fontSize: '13px',
                      marginTop: '4px',
                      display: 'block',
                    }}
                  >
                    {errors.first_name}
                  </span>
                )}
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Last Name</label>
                <input
                  className={styles.input}
                  name="last_name"
                  value={formData.last_name}
                  onChange={handleChange}
                  placeholder="Last Name"
                />
                {errors.last_name && (
                  <span
                    style={{
                      color: '#E53E3E',
                      fontSize: '13px',
                      marginTop: '4px',
                      display: 'block',
                    }}
                  >
                    {errors.last_name}
                  </span>
                )}
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Company</label>
              <input
                className={`${styles.input} ${styles.readOnlyInput}`}
                value={organization?.name || ''}
                disabled
                placeholder="Company Name"
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Email Address</label>
              <input
                className={`${styles.input} ${styles.readOnlyInput}`}
                value={user.email}
                disabled
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Job Title</label>
              <input
                name="jobTitle"
                className={styles.input}
                value={formData.jobTitle || ''}
                onChange={handleChange}
                placeholder="e.g. Caregiver"
              />
            </div>

            <div className={styles.formGrid}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>State</label>
                <input
                  className={`${styles.input} ${styles.readOnlyInput}`}
                  value={organization?.state || ''}
                  disabled
                  placeholder="State"
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Zip Code</label>
                <input
                  className={`${styles.input} ${styles.readOnlyInput}`}
                  value={organization?.zipCode || ''}
                  disabled
                  placeholder="Zip Code"
                />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Business Address</label>
              <input
                className={`${styles.input} ${styles.readOnlyInput}`}
                value={businessAddress}
                disabled
                placeholder="Business Address"
              />
            </div>

            {message && (
              <div
                className={`${styles.message} ${message.type === 'success' ? styles.success : styles.error}`}
              >
                {message.text}
              </div>
            )}

            <div className={styles.actions}>
              <Button type="submit" variant="primary" loading={isLoading} disabled={!isDirty}>
                Save Changes
              </Button>
            </div>
          </form>
        </div>
      </div>

      <Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)}>
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px' }}>
            Confirm Changes
          </h3>
          <p style={{ color: '#718096', marginBottom: '20px' }}>
            Are you sure you want to update your profile?
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
            <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmSave} loading={isLoading}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
