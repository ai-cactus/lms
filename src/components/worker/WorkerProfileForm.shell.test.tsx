/**
 * /worker/profile was left on the pre-redesign shell: uppercase underlined tabs
 * ("EDIT PROFILE", "CHANGE PASSWORD", "TWO FACTOR AUTH (2FA)") rendered as
 * plain divs inside a centred card. The Change Password and 2FA panels are the
 * SAME components the manager profile uses and were already built to the Figma
 * designs — they looked wrong here only because of the frame around them.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions/user', () => ({ updateProfile: vi.fn(), uploadAvatar: vi.fn() }));
vi.mock('../dashboard/ChangePasswordTab', () => ({
  ChangePasswordTab: () => <div data-testid="change-password-panel" />,
}));
vi.mock('../dashboard/TwoFactorAuthTab', () => ({
  TwoFactorAuthTab: () => <div data-testid="2fa-panel" />,
}));

import WorkerProfileForm from './WorkerProfileForm';

const user = {
  email: 'nurse@acme.test',
  firstName: 'Nina',
  lastName: 'Nurse',
  jobTitle: 'RN',
  avatarUrl: null,
  authProvider: 'credentials',
} as never;

describe('WorkerProfileForm — uses the shared Profile Settings shell', () => {
  it('renders the designed sidebar pills instead of the old uppercase tab strip', () => {
    render(<WorkerProfileForm user={user} organization={null} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'My Profile',
      'Change Password',
      'Two-factor Authentication',
    ]);
    // The pre-redesign labels are gone.
    expect(screen.queryByText('EDIT PROFILE')).not.toBeInTheDocument();
    expect(screen.queryByText('TWO FACTOR AUTH (2FA)')).not.toBeInTheDocument();
  });

  it('sends Back to the worker dashboard, not the manager one', () => {
    render(<WorkerProfileForm user={user} organization={null} />);

    expect(screen.getByRole('link', { name: /back/i })).toHaveAttribute('href', '/worker');
  });

  it('opens on My Profile', () => {
    render(<WorkerProfileForm user={user} organization={null} />);

    expect(screen.getByRole('tab', { name: 'My Profile' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByTestId('change-password-panel')).not.toBeInTheDocument();
  });

  it('shows the shared Change Password panel under its own heading', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const u = userEvent.setup();
    render(<WorkerProfileForm user={user} organization={null} />);

    await u.click(screen.getByRole('tab', { name: 'Change Password' }));

    expect(screen.getByTestId('change-password-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Change Password' })).toBeInTheDocument();
  });

  it('shows the shared 2FA panel under its own heading', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const u = userEvent.setup();
    render(<WorkerProfileForm user={user} organization={null} />);

    await u.click(screen.getByRole('tab', { name: 'Two-factor Authentication' }));

    expect(screen.getByTestId('2fa-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Two-factor Authentication' })).toBeInTheDocument();
  });
});
