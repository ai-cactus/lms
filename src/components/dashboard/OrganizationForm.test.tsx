/**
 * Regression tests for making the dashboard profile page's Organization tab
 * fully read-only: every field is permanently disabled (even for admins), the
 * Save Changes / Discard controls and the `<form>` submit were removed, while
 * the admin-only Worker Onboarding join-code generator (Section 4) and the
 * "No Organization Found" empty state are preserved.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const { getOrganizationCode, generateOrganizationCode } = vi.hoisted(() => ({
  getOrganizationCode: vi.fn(),
  generateOrganizationCode: vi.fn(),
}));
vi.mock('@/app/actions/organization-code', () => ({
  getOrganizationCode,
  generateOrganizationCode,
}));

import OrganizationForm from './OrganizationForm';

const baseOrg = {
  id: 'org-1',
  name: 'Acme Healthcare Ltd',
  dba: 'Acme Health',
  ein: '12-3456789',
  primaryContact: 'Jane Doe',
  primaryEmail: 'jane@acme.com',
  isHipaaCompliant: true,
  primaryBusinessType: 'private_group_practice',
  additionalBusinessTypes: ['outpatient_services', 'crisis_stabilization'],
};

beforeEach(() => {
  mockPush.mockClear();
  getOrganizationCode.mockReset().mockResolvedValue({ success: false });
  generateOrganizationCode.mockReset();
});

describe.each([
  ['admin', true],
  ['non-admin', false],
])('OrganizationForm — read-only fields (%s)', (_label, isAdmin) => {
  it('renders every field pre-filled from initialData and disabled', async () => {
    render(<OrganizationForm initialData={baseOrg} isAdmin={isAdmin} />);

    const textFields = [
      screen.getByDisplayValue('Acme Healthcare Ltd'),
      screen.getByDisplayValue('Acme Health'),
      screen.getByDisplayValue('12-3456789'),
      screen.getByDisplayValue('Jane Doe'),
      screen.getByDisplayValue('jane@acme.com'),
      // Primary/additional business type are read-only <Input>s (not Selects)
      // since the redesign, so their resolved labels show as input values.
      screen.getByDisplayValue('Private Practice / Group Practice'),
      screen.getByDisplayValue('Outpatient Services, Crisis Stabilization Unit'),
    ];
    textFields.forEach((field) => expect(field).toBeDisabled());

    // Only HIPAA compliance remains a Select combobox — business type fields
    // were converted to disabled/readOnly <Input>s so they can show resolved
    // labels (or free "Other" text) without needing a matching SelectItem.
    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes).toHaveLength(1);
    comboboxes.forEach((box) => expect(box).toBeDisabled());

    expect(screen.getByText('Yes')).toBeInTheDocument(); // HIPAA

    if (isAdmin) {
      await waitFor(() => expect(getOrganizationCode).toHaveBeenCalled());
    }
  });

  it('resolves a legacy (pre-redesign) primaryBusinessType id to its label via the fallback map', async () => {
    render(
      <OrganizationForm
        initialData={{ ...baseOrg, primaryBusinessType: 'clinic' }}
        isAdmin={isAdmin}
      />,
    );

    expect(screen.getByDisplayValue('Clinic')).toBeDisabled();

    if (isAdmin) {
      await waitFor(() => expect(getOrganizationCode).toHaveBeenCalled());
    }
  });

  it('falls back to the raw stored value for an unrecognized additionalBusinessTypes id with no legacy mapping', async () => {
    render(
      <OrganizationForm
        initialData={{ ...baseOrg, additionalBusinessTypes: ['non-profit'] }}
        isAdmin={isAdmin}
      />,
    );

    expect(screen.getByDisplayValue('non-profit')).toBeDisabled();

    if (isAdmin) {
      await waitFor(() => expect(getOrganizationCode).toHaveBeenCalled());
    }
  });

  it('renders no Save Changes / Discard buttons and no <form> element', async () => {
    const { container } = render(<OrganizationForm initialData={baseOrg} isAdmin={isAdmin} />);

    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^discard$/i })).not.toBeInTheDocument();
    expect(container.querySelector('form')).not.toBeInTheDocument();

    if (isAdmin) {
      await waitFor(() => expect(getOrganizationCode).toHaveBeenCalled());
    }
  });

  it('typing into a text field does not change its value', async () => {
    render(<OrganizationForm initialData={baseOrg} isAdmin={isAdmin} />);

    const name = screen.getByDisplayValue('Acme Healthcare Ltd');
    await userEvent.type(name, 'hello', { skipClick: true });

    expect(name).toHaveValue('Acme Healthcare Ltd');

    if (isAdmin) {
      await waitFor(() => expect(getOrganizationCode).toHaveBeenCalled());
    }
  });
});

describe('OrganizationForm — Worker Onboarding join-code generator gating', () => {
  it('shows Section 4 / join-code generator for admins and fetches the current code', async () => {
    render(<OrganizationForm initialData={baseOrg} isAdmin={true} />);

    expect(screen.getByText(/worker onboarding/i)).toBeInTheDocument();
    expect(screen.getByText(/organization join code/i)).toBeInTheDocument();
    await waitFor(() => expect(getOrganizationCode).toHaveBeenCalledTimes(1));
  });

  it('hides Section 4 / join-code generator for non-admins and never fetches a code', () => {
    render(<OrganizationForm initialData={baseOrg} isAdmin={false} />);

    expect(screen.queryByText(/worker onboarding/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/organization join code/i)).not.toBeInTheDocument();
    expect(getOrganizationCode).not.toHaveBeenCalled();
  });

  it('renders the join code returned by getOrganizationCode', async () => {
    getOrganizationCode.mockResolvedValue({
      success: true,
      code: '123456',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    render(<OrganizationForm initialData={baseOrg} isAdmin={true} />);

    expect(await screen.findByText('123456')).toBeInTheDocument();
  });
});

describe('OrganizationForm — empty state', () => {
  it('shows "No Organization Found" and does not fetch a join code', () => {
    render(<OrganizationForm initialData={null} isAdmin={true} />);

    expect(screen.getByText('No Organization Found')).toBeInTheDocument();
    expect(getOrganizationCode).not.toHaveBeenCalled();
  });

  it('navigates to onboarding when "Complete Onboarding" is clicked', async () => {
    render(<OrganizationForm initialData={null} isAdmin={true} />);

    await userEvent.click(screen.getByRole('button', { name: /complete onboarding/i }));

    expect(mockPush).toHaveBeenCalledWith('/onboarding/step1');
  });
});
