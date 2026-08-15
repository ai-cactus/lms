/**
 * The left nav on Profile Settings has exactly two variants in the Figma mocks:
 * an org-wide admin tier (My Profile · My Organization · My Facilities · …) and
 * a facility supervisor (My Profile · Assigned Facilities · …, with no
 * organization panel). These tests pin that gating and the routing from each
 * nav item to its panel.
 *
 * The panels are stubbed — each owns its own behaviour and, in the case of the
 * password / 2FA tabs, its own server actions.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./MyProfileSection', () => ({
  default: () => <div data-testid="my-profile-section" />,
}));
vi.mock('./MyOrganizationSection', () => ({
  default: () => <div data-testid="my-organization-section" />,
}));
vi.mock('./MyFacilitiesSection', () => ({
  default: () => <div data-testid="my-facilities-section" />,
}));
vi.mock('./AssignedFacilitiesSection', () => ({
  default: () => <div data-testid="assigned-facilities-section" />,
}));
vi.mock('../ChangePasswordTab', () => ({
  ChangePasswordTab: () => <div data-testid="change-password-tab" />,
}));
vi.mock('../TwoFactorAuthTab', () => ({
  TwoFactorAuthTab: () => <div data-testid="two-factor-tab" />,
}));

import ProfileSettings from './ProfileSettings';

const profile = {
  id: 'user-1',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@acme.com',
  role: 'owner' as const,
  roleDisplayName: 'Owner (Organisation Admin)',
};

const baseProps = {
  profile,
  organization: null,
  complianceDocuments: [],
  facilities: [],
};

function renderAdmin(overrides: Record<string, unknown> = {}) {
  return render(
    <ProfileSettings
      {...baseProps}
      showOrganization
      canEditOrganization
      facilitiesMode="organization"
      {...overrides}
    />,
  );
}

describe('ProfileSettings — nav variants', () => {
  it('offers the admin-tier nav: profile, organization, my facilities, password, 2FA', () => {
    renderAdmin();

    expect(screen.getByRole('tab', { name: 'My Profile' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'My Organization' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'My Facilities' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Change Password' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Two-factor Authentication' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Assigned Facilities' })).not.toBeInTheDocument();
  });

  it('offers the supervisor nav: assigned facilities, and no organization panel', () => {
    render(
      <ProfileSettings
        {...baseProps}
        showOrganization={false}
        canEditOrganization={false}
        facilitiesMode="assigned"
      />,
    );

    expect(screen.getByRole('tab', { name: 'Assigned Facilities' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'My Organization' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'My Facilities' })).not.toBeInTheDocument();
  });

  it('drops the facilities item entirely when the role cannot read facilities', () => {
    render(
      <ProfileSettings
        {...baseProps}
        showOrganization
        canEditOrganization={false}
        facilitiesMode="none"
      />,
    );

    expect(screen.queryByRole('tab', { name: /facilities/i })).not.toBeInTheDocument();
  });

  it('opens on My Profile', () => {
    renderAdmin();

    expect(screen.getByRole('tab', { name: 'My Profile' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('my-profile-section')).toBeInTheDocument();
  });
});

describe('ProfileSettings — panel routing', () => {
  it('renders the organization panel from its nav item', async () => {
    renderAdmin();

    await userEvent.click(screen.getByRole('tab', { name: 'My Organization' }));

    expect(screen.getByTestId('my-organization-section')).toBeInTheDocument();
    expect(screen.queryByTestId('my-profile-section')).not.toBeInTheDocument();
  });

  it('renders the org-wide facility list for an admin-tier seat', async () => {
    renderAdmin();

    await userEvent.click(screen.getByRole('tab', { name: 'My Facilities' }));

    expect(screen.getByTestId('my-facilities-section')).toBeInTheDocument();
  });

  it('renders the assigned-facility list for a supervisor', async () => {
    render(
      <ProfileSettings
        {...baseProps}
        showOrganization={false}
        canEditOrganization={false}
        facilitiesMode="assigned"
      />,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Assigned Facilities' }));

    expect(screen.getByTestId('assigned-facilities-section')).toBeInTheDocument();
  });

  it('renders the password and 2FA tabs', async () => {
    renderAdmin();

    await userEvent.click(screen.getByRole('tab', { name: 'Change Password' }));
    expect(screen.getByTestId('change-password-tab')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Two-factor Authentication' }));
    expect(screen.getByTestId('two-factor-tab')).toBeInTheDocument();
  });
});
