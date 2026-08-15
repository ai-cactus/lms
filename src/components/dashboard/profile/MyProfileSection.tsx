'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Field } from '@/components/ui';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updateProfile, uploadAvatar } from '@/app/actions/user';
import { PanelCard, ReadField } from './ui';
import type { ProfileData } from './types';

interface MyProfileSectionProps {
  profile: ProfileData;
  organizationName: string | null;
}

interface EditableProfile {
  first_name: string;
  last_name: string;
}

function toEditable(profile: ProfileData): EditableProfile {
  return {
    first_name: profile.first_name,
    last_name: profile.last_name,
  };
}

export default function MyProfileSection({ profile, organizationName }: MyProfileSectionProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EditableProfile>(() => toEditable(profile));
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl ?? null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    profile.avatarDisplayUrl ?? null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fullName = `${profile.first_name} ${profile.last_name}`.trim() || 'Your profile';
  const monogram =
    `${form.first_name[0] ?? ''}${form.last_name[0] ?? ''}`.toUpperCase().trim() || 'U';

  const isValid = form.first_name.trim() !== '' && form.last_name.trim() !== '';
  const isDirty =
    form.first_name !== profile.first_name ||
    form.last_name !== profile.last_name ||
    avatarUrl !== (profile.avatarUrl ?? null);

  const startEditing = () => {
    setMessage(null);
    setForm(toEditable(profile));
    setAvatarUrl(profile.avatarUrl ?? null);
    setAvatarPreview(profile.avatarDisplayUrl ?? null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setForm(toEditable(profile));
    setAvatarUrl(profile.avatarUrl ?? null);
    setAvatarPreview(profile.avatarDisplayUrl ?? null);
    setMessage(null);
    setIsEditing(false);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setAvatarPreview(URL.createObjectURL(file));
    setIsUploading(true);
    setMessage(null);

    const payload = new FormData();
    payload.append('file', file);

    try {
      const result = await uploadAvatar(payload);
      if (result.success && result.url) {
        setAvatarUrl(result.url);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to upload photo' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to upload photo' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmSave = async () => {
    setShowConfirm(false);
    setIsSaving(true);
    setMessage(null);

    try {
      const result = await updateProfile({
        first_name: form.first_name,
        last_name: form.last_name,
        avatarUrl: avatarUrl || undefined,
      });

      if (!result.success) throw new Error(result.error);

      setMessage({ type: 'success', text: 'Profile updated successfully' });
      setIsEditing(false);
      router.refresh();
    } catch (error) {
      setMessage({
        type: 'error',
        text: (error as Error).message || 'Failed to update profile',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const avatar = (
    <div className="relative w-fit shrink-0">
      <div className="flex size-24 items-center justify-center overflow-hidden rounded-full bg-background-secondary text-2xl font-semibold text-text-secondary">
        {avatarPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarPreview} alt="" className="size-full object-cover" />
        ) : (
          monogram
        )}
      </div>
      {isEditing && (
        <>
          <Button
            size="icon-sm"
            type="button"
            loading={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className="absolute right-0 bottom-0 size-8 rounded-full"
            aria-label="Change profile photo"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
          />
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-foreground">My Profile</h2>
        {isEditing ? (
          <div className="flex items-center gap-3">
            <Button variant="outline" type="button" onClick={cancelEditing} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={!isValid || !isDirty || isUploading}
              loading={isSaving}
            >
              Save
            </Button>
          </div>
        ) : (
          <Button variant="outline" type="button" onClick={startEditing} className="gap-2">
            Edit
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {message && <Alert variant={message.type}>{message.text}</Alert>}

      <PanelCard>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
          {avatar}
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-lg font-semibold break-words text-foreground">{fullName}</p>
            <p className="text-sm text-text-secondary">{profile.roleDisplayName}</p>
            {organizationName && <p className="text-sm text-text-secondary">{organizationName}</p>}
          </div>
        </div>
      </PanelCard>

      <PanelCard>
        <h3 className="mb-6 text-base font-semibold text-foreground">Personal Information</h3>

        {isEditing ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label="First Name"
              required
              error={form.first_name.trim() ? undefined : 'First name is required'}
            >
              <Input
                name="first_name"
                value={form.first_name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, first_name: event.target.value }))
                }
                placeholder="Jane"
              />
            </Field>
            <Field
              label="Last Name"
              required
              error={form.last_name.trim() ? undefined : 'Last name is required'}
            >
              <Input
                name="last_name"
                value={form.last_name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, last_name: event.target.value }))
                }
                placeholder="Doe"
              />
            </Field>
            {/* Email is the account identifier — changing it is an auth flow, not
                a profile edit, so it stays locked here. */}
            <Field label="Email address">
              <Input name="email" value={profile.email} disabled readOnly />
            </Field>
            {/* Job title mirrors the assigned role — role changes are an admin
                action, not a self-serve profile edit, so it stays locked here. */}
            <Field label="Job Title">
              <Input name="jobTitle" value={profile.roleDisplayName} disabled readOnly />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <ReadField label="First Name" value={profile.first_name} />
            <ReadField label="Last Name" value={profile.last_name} />
            <ReadField label="Email address" value={profile.email} />
            <ReadField label="Job Title" value={profile.roleDisplayName} />
          </div>
        )}
      </PanelCard>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
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
