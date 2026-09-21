/**
 * The save payload. An emptied Job Title used to be sent as `undefined`
 * (`formData.jobTitle || undefined`), which updateProfile reads as "leave
 * unchanged" — so a worker could never clear their title, and the form still
 * reported success.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUpdateProfile } = vi.hoisted(() => ({ mockUpdateProfile: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions/user', () => ({ updateProfile: mockUpdateProfile, uploadAvatar: vi.fn() }));
vi.mock('../dashboard/ChangePasswordTab', () => ({ ChangePasswordTab: () => null }));
vi.mock('../dashboard/TwoFactorAuthTab', () => ({ TwoFactorAuthTab: () => null }));

import WorkerProfileForm from './WorkerProfileForm';

const user = {
  id: 'user-1',
  first_name: 'Nina',
  last_name: 'Nurse',
  email: 'nurse@acme.test',
  role: 'worker',
  jobTitle: 'RN',
  avatarUrl: null,
  avatarDisplayUrl: null,
  authProvider: 'credentials',
};

async function saveWithJobTitle(value: string) {
  const u = userEvent.setup();
  render(<WorkerProfileForm user={user} organization={null} />);

  const jobTitle = screen.getByPlaceholderText('e.g. Caregiver');
  await u.clear(jobTitle);
  if (value) await u.type(jobTitle, value);

  await u.click(screen.getByRole('button', { name: 'Save Changes' }));
  await u.click(await screen.findByRole('button', { name: 'Confirm' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateProfile.mockResolvedValue({ success: true });
});

describe('WorkerProfileForm — job title save payload', () => {
  it('sends an explicit null when the job title is cleared', async () => {
    await saveWithJobTitle('');

    expect(mockUpdateProfile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ jobTitle: null }),
    );
  });

  it('sends a whitespace-only job title as a clear too', async () => {
    await saveWithJobTitle('   ');

    expect(mockUpdateProfile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ jobTitle: null }),
    );
  });

  it('sends the edited title, trimmed', async () => {
    await saveWithJobTitle('  Charge Nurse ');

    expect(mockUpdateProfile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ jobTitle: 'Charge Nurse' }),
    );
  });
});
