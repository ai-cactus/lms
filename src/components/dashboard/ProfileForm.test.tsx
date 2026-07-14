/**
 * Regression tests for the profile page's Organization/Facility tabs: the
 * `canEditFacility` prop was removed from ProfileForm (organization and
 * facility data are now always read-only, rendered by OrganizationForm /
 * FacilityForm themselves), while `canReadFacility` still gates whether the
 * "YOUR FACILITY" tab is shown at all.
 *
 * OrganizationForm / FacilityForm / ChangePasswordTab / TwoFactorAuthTab are
 * stubbed — each has its own dedicated test file, and pulling in the real
 * OrganizationForm here would require mocking the organization-code server
 * actions for no benefit to this component's own tab-gating logic.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/actions/user', () => ({
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
}));
vi.mock('./OrganizationForm', () => ({
  default: () => <div data-testid="organization-form" />,
}));
vi.mock('./FacilityForm', () => ({
  default: () => <div data-testid="facility-form" />,
}));
vi.mock('./ChangePasswordTab', () => ({
  ChangePasswordTab: () => <div data-testid="change-password-tab" />,
}));
vi.mock('./TwoFactorAuthTab', () => ({
  TwoFactorAuthTab: () => <div data-testid="two-factor-tab" />,
}));

import ProfileForm from './ProfileForm';

const baseProfile = {
  id: 'user-1',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@acme.com',
  role: 'owner' as const,
};

describe('ProfileForm — YOUR FACILITY tab gating', () => {
  it('shows the facility tab and renders FacilityForm when canReadFacility is true', async () => {
    render(
      <ProfileForm
        initialData={baseProfile}
        organizationData={null}
        facilityData={null}
        canReadFacility={true}
      />,
    );

    const facilityTab = screen.getByRole('button', { name: /your facility/i });
    expect(facilityTab).toBeInTheDocument();

    await userEvent.click(facilityTab);
    expect(screen.getByTestId('facility-form')).toBeInTheDocument();
  });

  it('hides the facility tab when canReadFacility is false', () => {
    render(
      <ProfileForm
        initialData={baseProfile}
        organizationData={null}
        facilityData={null}
        canReadFacility={false}
      />,
    );

    expect(screen.queryByRole('button', { name: /your facility/i })).not.toBeInTheDocument();
  });

  it('hides the facility tab when canReadFacility is omitted (defaults to false)', () => {
    render(<ProfileForm initialData={baseProfile} />);

    expect(screen.queryByRole('button', { name: /your facility/i })).not.toBeInTheDocument();
  });

  it('renders without a canEditFacility prop and still shows the organization tab', async () => {
    render(
      <ProfileForm
        initialData={baseProfile}
        organizationData={null}
        facilityData={null}
        canReadFacility={true}
      />,
    );

    const orgTab = screen.getByRole('button', { name: /your organization/i });
    await userEvent.click(orgTab);

    expect(screen.getByTestId('organization-form')).toBeInTheDocument();
  });
});
