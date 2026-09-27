/**
 * The save payload. Founder ruling Q3/Q17 (2026-09-23) retired job titles: the
 * system-assigned role IS the title, so this form must not offer one and must
 * not send one — `updateProfile` no longer accepts the key at all.
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
  last_name: 'Adeyemi',
  email: 'nurse@acme.test',
  role: 'nurse' as const,
  avatarUrl: null,
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

    expect(mockUpdateProfile).toHaveBeenCalledExactlyOnceWith({
      first_name: 'Nina-Rose',
      last_name: 'Adeyemi',
      avatarUrl: undefined,
    });
  });
});
