/**
 * The save payload. Founder ruling Q3/Q17 (2026-09-23) retired job titles: the
 * system-assigned role IS the title, so this form must not offer one and must
 * not send one — `updateProfile` no longer accepts the key at all.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUpdateProfile, mockUploadAvatar } = vi.hoisted(() => ({
  mockUpdateProfile: vi.fn(),
  mockUploadAvatar: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions/user', () => ({
  updateProfile: mockUpdateProfile,
  uploadAvatar: mockUploadAvatar,
}));
vi.mock('../dashboard/ChangePasswordTab', () => ({ ChangePasswordTab: () => null }));
vi.mock('../dashboard/TwoFactorAuthTab', () => ({ TwoFactorAuthTab: () => null }));

import WorkerProfileForm from './WorkerProfileForm';

const user = {
  id: 'user-1',
  first_name: 'Nina',
  last_name: 'Adeyemi',
  email: 'nurse@acme.test',
  role: 'nurse' as const,
  avatarDisplayUrl: null,
  authProvider: 'credentials',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateProfile.mockResolvedValue({ success: true });
});

describe('WorkerProfileForm — profile save payload', () => {
  it('offers no job-title field and shows the assigned role read-only instead', () => {
    render(<WorkerProfileForm user={user} organization={null} />);

    expect(screen.queryByPlaceholderText('e.g. Caregiver')).not.toBeInTheDocument();
    expect(screen.queryByText('Job Title')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Nurse')).toBeDisabled();
  });

  it('sends only the name and avatar, never a job title', async () => {
    const u = userEvent.setup();
    render(<WorkerProfileForm user={user} organization={null} />);

    await u.clear(screen.getByPlaceholderText('First Name'));
    await u.type(screen.getByPlaceholderText('First Name'), 'Nina-Rose');
    await u.click(screen.getByRole('button', { name: 'Save Changes' }));
    await u.click(await screen.findByRole('button', { name: 'Confirm' }));

    // BUG-05: the worker form names its own portal; the action never guesses it.
    expect(mockUpdateProfile).toHaveBeenCalledExactlyOnceWith('worker', {
      first_name: 'Nina-Rose',
      last_name: 'Adeyemi',
      avatarUrl: undefined,
    });
  });

  // RISK-02: `undefined` means "leave unchanged". BUG-65: the page sends only a
  // signed display URL, which must never be echoed back as the photo.
  it('does not resend an unchanged photo', async () => {
    const u = userEvent.setup();
    render(
      <WorkerProfileForm
        user={{ ...user, avatarDisplayUrl: 'https://signed.example/old.png?sig=1' }}
        organization={null}
      />,
    );

    await u.type(screen.getByPlaceholderText('Last Name'), 'x');
    await u.click(screen.getByRole('button', { name: 'Save Changes' }));
    await u.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(mockUpdateProfile).toHaveBeenCalledExactlyOnceWith(
      'worker',
      expect.objectContaining({ avatarUrl: undefined }),
    );
  });

  it('sends a newly uploaded photo, uploaded against the worker portal', async () => {
    mockUploadAvatar.mockResolvedValue({ success: true, url: 'gcs://b/avatars/user-1/new.png' });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
    const u = userEvent.setup();
    const { container } = render(<WorkerProfileForm user={user} organization={null} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await u.upload(input, new File(['x'], 'me.png', { type: 'image/png' }));
    await u.click(screen.getByRole('button', { name: 'Save Changes' }));
    await u.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(mockUploadAvatar).toHaveBeenCalledWith('worker', expect.any(FormData));
    expect(mockUpdateProfile).toHaveBeenCalledExactlyOnceWith(
      'worker',
      expect.objectContaining({ avatarUrl: 'gcs://b/avatars/user-1/new.png' }),
    );
  });

  it('sends an uploaded photo once: a second save leaves it unchanged', async () => {
    mockUploadAvatar.mockResolvedValue({ success: true, url: 'gcs://b/avatars/user-1/new.png' });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
    const u = userEvent.setup();
    const { container } = render(<WorkerProfileForm user={user} organization={null} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await u.upload(input, new File(['x'], 'me.png', { type: 'image/png' }));
    await u.click(screen.getByRole('button', { name: 'Save Changes' }));
    await u.click(await screen.findByRole('button', { name: 'Confirm' }));
    await screen.findByText('Profile updated successfully');

    await u.type(screen.getByPlaceholderText('Last Name'), 'x');
    await u.click(screen.getByRole('button', { name: 'Save Changes' }));
    await u.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(mockUpdateProfile).toHaveBeenCalledTimes(2);
    expect(mockUpdateProfile).toHaveBeenLastCalledWith(
      'worker',
      expect.objectContaining({ avatarUrl: undefined }),
    );
  });
});
