/**
 * Unit tests for src/components/dashboard/staff/InviteStaffModal.tsx
 *
 * The modal is a three-step flow: step 1 picks the target facility and collects
 * emails (textarea + CSV upload), step 2 assigns a role to each parsed contact,
 * then `createInvites(items, { facilityId })` runs and a success screen is
 * shown. These tests guard the seams a component test can catch:
 *   - step 1 → step 2 navigation ("Assign role") is gated on a chosen facility AND at least one
 *     valid parsed email;
 *   - "Global" submits an explicit `facilityId: null` (skip the inviter-facility
 *     fallback) while a named facility submits its id;
 *   - the back-chevron returns to step 1 preserving the typed input;
 *   - the seat-cap (seatsExhausted) disables "Assign role" and shows the
 *     "no remaining seats" copy.
 *
 * Radix `Select` needs `hasPointerCapture` / `scrollIntoView` / `ResizeObserver`,
 * none of which jsdom provides — they are stubbed below so the facility and role
 * dropdowns can actually be driven.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockCreateInvites, mockRouterRefresh } = vi.hoisted(() => ({
  mockCreateInvites: vi.fn(),
  mockRouterRefresh: vi.fn(),
}));

vi.mock('@/app/actions/invite', () => ({ createInvites: mockCreateInvites }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRouterRefresh, push: vi.fn() }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import InviteStaffModal from './InviteStaffModal';

// ── jsdom stubs Radix Select depends on ───────────────────────────────────────

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

// ── Helpers ───────────────────────────────────────────────────────────────────

const FACILITIES = [
  { id: 'fac-1', name: 'Northside Clinic', type: 'Behavioral Health', city: 'Denver, CO' },
  { id: 'fac-2', name: 'Lakeside Pediatrics', type: 'Behavioral Health', city: 'Denver, CO' },
];

function renderModal(overrides: Partial<React.ComponentProps<typeof InviteStaffModal>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    remainingSeats: null as number | null,
    planName: 'Professional',
    inviterRole: 'owner' as const,
    facilities: FACILITIES,
    ...overrides,
  };
  return { ...render(<InviteStaffModal {...props} />), props };
}

function emailTextarea() {
  return screen.getByPlaceholderText(/enter emails separated by/i);
}

/** Opens the Facility dropdown and picks the option whose label matches. */
async function chooseFacility(label: string | RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Facility' }));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

/** Picks a role in the bulk select WITHOUT applying it. */
async function chooseBulkRole(roleLabel: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Role to apply to everyone' }));
  await userEvent.click(await screen.findByRole('option', { name: roleLabel }));
}

/** Assigns the same role to every contact: choose in the bulk select, then Apply to all. */
async function setEveryRoleTo(roleLabel: string) {
  await chooseBulkRole(roleLabel);
  await userEvent.click(screen.getByRole('button', { name: 'Apply to all' }));
}

/** Picks a role in one row's select. */
async function setRowRole(email: string, roleLabel: string) {
  await userEvent.click(screen.getByRole('combobox', { name: `Role for ${email}` }));
  await userEvent.click(await screen.findByRole('option', { name: roleLabel }));
}

/** Facility (default: a named one, so worker roles are offered) → emails → "Assign role". */
async function goToAssignStep(emails: string, facility: string | RegExp = /Northside Clinic/) {
  await chooseFacility(facility);
  await userEvent.type(emailTextarea(), emails);
  await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));
  await screen.findByRole('heading', { name: 'Assign roles' });
}

/** Uploads a CSV through the (portaled, hidden) file input and waits for the import badge. */
async function uploadCsv(csvText: string, importedLabel: RegExp) {
  const csv = new File([csvText], 'staff.csv', { type: 'text/csv' });
  // jsdom's File lacks arrayBuffer(); the real parser (SheetJS) is left untouched.
  csv.arrayBuffer = async () => new TextEncoder().encode(csvText).buffer as ArrayBuffer;
  await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, csv);
  await screen.findByText(importedLabel, {}, { timeout: 10000 });
}

/** Opens a role select, returns the option names, and closes it again. */
async function optionNamesOf(combobox: HTMLElement) {
  await userEvent.click(combobox);
  const names = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
  await userEvent.keyboard('{Escape}');
  return names;
}

function bulkSelect() {
  return screen.getByRole('combobox', { name: 'Role to apply to everyone' });
}

const FACILITY_ROLE_NAMES = [
  'Facility Supervisor',
  'Psychiatrist / Prescriber',
  'Nurse',
  'Therapist / Clinician',
  'Case Manager',
  'Behavioral Health Technician / Mental Health Associate',
  'Peer Support Specialist',
  'Front Desk / Administrative Support',
  'Facilities / Support Staff',
];

function rowComboboxes() {
  return screen.getAllByRole('combobox', { name: /^Role for / });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateInvites.mockResolvedValue({
    success: true,
    results: [{ email: 'worker@acme.com', status: 'sent' }],
  });
});

describe('InviteStaffModal — step 1 facility + email entry', () => {
  it('renders the "Invite New Staff" step with the facility select above the email textarea', () => {
    renderModal();
    expect(screen.getByText('Invite New Staff')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Facility' })).toBeInTheDocument();
    expect(emailTextarea()).toBeInTheDocument();
  });

  it('keeps Assign role disabled until at least one valid email is parsed', async () => {
    renderModal();
    const assignRoleBtn = screen.getByRole('button', { name: /^assign role$/i });
    expect(assignRoleBtn).toBeDisabled();

    await userEvent.type(emailTextarea(), 'not-an-email');
    expect(assignRoleBtn).toBeDisabled();

    await userEvent.clear(emailTextarea());
    await userEvent.type(emailTextarea(), 'newworker@acme.com');
    expect(assignRoleBtn).toBeEnabled();
  });

  it('blocks Assign role with a field error while no facility has been chosen', async () => {
    renderModal();
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));

    expect(screen.getByText(/select a facility before continuing/i)).toBeInTheDocument();
    expect(screen.queryByText('Assign roles')).not.toBeInTheDocument();
  });

  it('clears the facility error and advances once a facility is chosen', async () => {
    renderModal();
    await userEvent.type(emailTextarea(), 'a@acme.com, b@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));
    expect(screen.getByText(/select a facility before continuing/i)).toBeInTheDocument();

    await chooseFacility(/Northside Clinic/);
    expect(screen.queryByText(/select a facility before continuing/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));

    expect(screen.getByText('Assign roles')).toBeInTheDocument();
    expect(screen.getByText('2 staff on this list')).toBeInTheDocument();
  });
});

describe('InviteStaffModal — step navigation', () => {
  it('returns to step 1 preserving the typed emails when the back chevron is clicked', async () => {
    renderModal();
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'keep@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));

    expect(screen.getByText('Assign roles')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /back to email entry/i }));

    expect(screen.getByText('Invite New Staff')).toBeInTheDocument();
    // The email was committed to a chip (with its remove button) when focus left
    // the input on "Assign role" — the chip must survive the round-trip to step 2.
    expect(screen.getByText('keep@acme.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove keep@acme.com' })).toBeInTheDocument();
  });

  it('keeps the step-2 "Invite N staff" CTA disabled until every contact has a role', async () => {
    renderModal();
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));

    // On step 2 the contact still has no role assigned → the CTA stays disabled.
    expect(screen.getByRole('button', { name: 'Invite 1 staff' })).toBeDisabled();
  });
});

describe('InviteStaffModal — facility passed to createInvites', () => {
  it('submits an explicit null facilityId for the Global option', async () => {
    renderModal();
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'a@acme.com, b@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));

    await setEveryRoleTo('HR');
    await userEvent.click(screen.getByRole('button', { name: 'Invite 2 staff' }));

    await waitFor(() =>
      expect(mockCreateInvites).toHaveBeenCalledWith(
        [
          { email: 'a@acme.com', role: 'hr' },
          { email: 'b@acme.com', role: 'hr' },
        ],
        { facilityId: null },
      ),
    );
  });

  it('submits the chosen facility id for a named facility', async () => {
    renderModal();
    await chooseFacility(/Lakeside Pediatrics/);
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));

    await setEveryRoleTo('Nurse');
    await userEvent.click(screen.getByRole('button', { name: 'Invite 1 staff' }));

    await waitFor(() =>
      expect(mockCreateInvites).toHaveBeenCalledWith([{ email: 'a@acme.com', role: 'nurse' }], {
        facilityId: 'fac-2',
      }),
    );
  });

  it('shows the success step copy and the Okay button once the invites are sent', async () => {
    mockCreateInvites.mockResolvedValue({
      success: true,
      results: [{ email: 'a@acme.com', status: 'sent' }],
    });
    renderModal();
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));

    await setEveryRoleTo('HR');
    await userEvent.click(screen.getByRole('button', { name: 'Invite 1 staff' }));

    expect(await screen.findByText('Invite sent')).toBeInTheDocument();
    expect(screen.getByText(/1 staff invited\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Okay' })).toBeInTheDocument();
  });
});

describe('InviteStaffModal — step 2 bulk role assignment', () => {
  it('lists the staff count badge, the bulk card and the individual table, with the bulk select first in DOM order', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');

    expect(screen.getByText('2 staff on this list')).toBeInTheDocument();
    expect(screen.getByText('Bulk assign a role to all 2 staff')).toBeInTheDocument();
    expect(screen.getByText('or assign individually')).toBeInTheDocument();
    expect(screen.queryByText(/contacts? found/i)).not.toBeInTheDocument();

    const names = screen.getAllByRole('combobox').map((c) => c.getAttribute('aria-label'));
    expect(names).toEqual([
      'Role to apply to everyone',
      'Role for a@acme.com',
      'Role for b@acme.com',
    ]);
    expect(screen.getByRole('table', { name: 'Staff to invite' })).toBeInTheDocument();
  });

  it('does not change any row when a bulk role is chosen but Apply to all has not been clicked', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');

    await chooseBulkRole('Nurse');

    for (const trigger of rowComboboxes()) {
      expect(trigger).toHaveTextContent('Choose a role');
    }
    expect(screen.getByRole('button', { name: 'Invite 2 staff' })).toBeDisabled();
  });

  it('keeps Apply to all disabled until a bulk role is chosen', async () => {
    renderModal();
    await goToAssignStep('a@acme.com');

    const apply = screen.getByRole('button', { name: 'Apply to all' });
    expect(apply).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Role to apply to everyone' })).toHaveTextContent(
      'Choose a role',
    );

    await chooseBulkRole('Nurse');
    expect(apply).toBeEnabled();
  });

  it('applies the chosen role to every row and enables Invite N staff only after Apply', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');
    expect(screen.getByRole('button', { name: 'Invite 2 staff' })).toBeDisabled();

    await setEveryRoleTo('Nurse');

    for (const trigger of rowComboboxes()) {
      expect(trigger).toHaveTextContent('Nurse');
    }
    expect(screen.getByRole('button', { name: 'Invite 2 staff' })).toBeEnabled();
  });

  it('keeps Invite disabled while only some rows have a role and enables it once the last row is set', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');

    await setRowRole('a@acme.com', 'Case Manager');
    expect(screen.getByRole('button', { name: 'Invite 2 staff' })).toBeDisabled();

    await setRowRole('b@acme.com', 'Nurse');
    expect(screen.getByRole('button', { name: 'Invite 2 staff' })).toBeEnabled();
  });

  it('overwrites a role pre-filled from an uploaded CSV when Apply to all is clicked', async () => {
    renderModal();
    await chooseFacility(/Northside Clinic/);
    await uploadCsv(
      'email,role\nprefilled@acme.com,nurse\nblank@acme.com,\n',
      /2 contacts imported/i,
    );

    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));
    await screen.findByRole('heading', { name: 'Assign roles' });

    expect(screen.getByRole('combobox', { name: 'Role for prefilled@acme.com' })).toHaveTextContent(
      'Nurse',
    );
    expect(screen.getByRole('combobox', { name: 'Role for blank@acme.com' })).toHaveTextContent(
      'Choose a role',
    );

    await setEveryRoleTo('Case Manager');

    expect(screen.getByRole('combobox', { name: 'Role for prefilled@acme.com' })).toHaveTextContent(
      'Case Manager',
    );
    expect(screen.getByRole('combobox', { name: 'Role for blank@acme.com' })).toHaveTextContent(
      'Case Manager',
    );
  });

  it('submits the bulk-applied role for every row to createInvites', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');
    await setEveryRoleTo('Nurse');
    await setRowRole('b@acme.com', 'Case Manager');
    await userEvent.click(screen.getByRole('button', { name: 'Invite 2 staff' }));

    await waitFor(() =>
      expect(mockCreateInvites).toHaveBeenCalledWith(
        [
          { email: 'a@acme.com', role: 'nurse' },
          { email: 'b@acme.com', role: 'case_manager' },
        ],
        { facilityId: 'fac-1' },
      ),
    );
  });

  it('follows row removals in the badge, the bulk card title and the Invite button', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com, c@acme.com');
    expect(screen.getByText('3 staff on this list')).toBeInTheDocument();
    expect(screen.getByText('Bulk assign a role to all 3 staff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite 3 staff' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove b@acme.com' }));

    expect(screen.getByText('2 staff on this list')).toBeInTheDocument();
    expect(screen.getByText('Bulk assign a role to all 2 staff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite 2 staff' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Role for b@acme.com' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove c@acme.com' }));

    expect(screen.getByText('1 staff on this list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite 1 staff' })).toBeInTheDocument();
  });

  it('shows the empty line, hides the bulk card and table, and disables Invite once every row is removed', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');

    await userEvent.click(screen.getByRole('button', { name: 'Remove a@acme.com' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove b@acme.com' }));

    expect(screen.getByText('No staff left on this list.')).toBeInTheDocument();
    expect(screen.getByText('0 staff on this list')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Staff to invite' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply to all' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Role to apply to everyone' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite 0 staff' })).toBeDisabled();
  });

  it('keeps the chosen bulk role and the rows picked earlier when going Back and re-entering the same facility', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');
    await setRowRole('a@acme.com', 'Case Manager');
    await chooseBulkRole('Nurse');

    await userEvent.click(screen.getByRole('button', { name: /back to email entry/i }));
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));
    await screen.findByRole('heading', { name: 'Assign roles' });

    expect(bulkSelect()).toHaveTextContent('Nurse');
    expect(screen.getByRole('button', { name: 'Apply to all' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Role for a@acme.com' })).toHaveTextContent(
      'Case Manager',
    );
    expect(screen.getByRole('combobox', { name: 'Role for b@acme.com' })).toHaveTextContent(
      'Choose a role',
    );
    expect(screen.queryByText(/some roles were cleared/i)).not.toBeInTheDocument();
  });

  it('clears the status announcement after Back and re-entry', async () => {
    renderModal();
    await goToAssignStep('a@acme.com');
    await setEveryRoleTo('Nurse');
    expect(screen.getByRole('status')).toHaveTextContent('Role set to Nurse for 1 staff');

    await userEvent.click(screen.getByRole('button', { name: /back to email entry/i }));
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));
    await screen.findByRole('heading', { name: 'Assign roles' });

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('InviteStaffModal — roles offered per invite path', () => {
  it('offers only the org-wide roles under Global (owner: Admin, HR, Clinical Director, Finance)', async () => {
    renderModal();
    await goToAssignStep('a@acme.com', /^Global/);

    expect(await optionNamesOf(bulkSelect())).toEqual([
      'Admin',
      'HR',
      'Clinical Director',
      'Finance',
    ]);
    expect(
      await optionNamesOf(screen.getByRole('combobox', { name: 'Role for a@acme.com' })),
    ).toEqual(['Admin', 'HR', 'Clinical Director', 'Finance']);
  });

  it('offers only Facility Supervisor and the worker roles under a named facility', async () => {
    renderModal();
    await goToAssignStep('a@acme.com');

    const bulk = await optionNamesOf(bulkSelect());
    expect(bulk).toEqual(FACILITY_ROLE_NAMES);
    expect(bulk).not.toContain('HR');
    expect(bulk).not.toContain('Finance');
    expect(bulk).not.toContain('Clinical Director');
    expect(bulk).not.toContain('Admin');
    expect(
      await optionNamesOf(screen.getByRole('combobox', { name: 'Role for a@acme.com' })),
    ).toEqual(FACILITY_ROLE_NAMES);
  });

  it('never offers Owner, and an HR inviter is not offered Admin under Global', async () => {
    renderModal({ inviterRole: 'hr' });
    await goToAssignStep('a@acme.com', /^Global/);

    const names = await optionNamesOf(bulkSelect());
    expect(names).toEqual(['HR', 'Clinical Director', 'Finance']);
    expect(names.join('|')).not.toMatch(/owner|admin/i);
  });

  it('clears picked roles and the bulk role, and shows the notice, when Back leads to the other path', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');
    await setEveryRoleTo('Nurse');
    await chooseBulkRole('Case Manager');

    await userEvent.click(screen.getByRole('button', { name: /back to email entry/i }));
    await chooseFacility(/^Global/);
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));
    await screen.findByRole('heading', { name: 'Assign roles' });

    expect(
      screen.getByText(
        "Some roles were cleared because they aren't available for the selected facility.",
      ),
    ).toBeInTheDocument();
    for (const trigger of rowComboboxes()) {
      expect(trigger).toHaveTextContent('Choose a role');
    }
    expect(bulkSelect()).toHaveTextContent('Choose a role');
    expect(screen.getByRole('button', { name: 'Apply to all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Invite 2 staff' })).toBeDisabled();
  });

  it('keeps every pick and shows no notice when Back leads to a different named facility', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');
    await setEveryRoleTo('Nurse');
    await setRowRole('b@acme.com', 'Case Manager');

    await userEvent.click(screen.getByRole('button', { name: /back to email entry/i }));
    await chooseFacility(/Lakeside Pediatrics/);
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));
    await screen.findByRole('heading', { name: 'Assign roles' });

    expect(screen.queryByText(/some roles were cleared/i)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for a@acme.com' })).toHaveTextContent(
      'Nurse',
    );
    expect(screen.getByRole('combobox', { name: 'Role for b@acme.com' })).toHaveTextContent(
      'Case Manager',
    );
    expect(screen.getByRole('button', { name: 'Invite 2 staff' })).toBeEnabled();
  });

  it('blanks a CSV pre-fill that does not fit a Global invite, keeps the one that does, and says so', async () => {
    renderModal();
    await chooseFacility(/^Global/);
    await uploadCsv(
      'email,role\nworker@acme.com,nurse\nmanager@acme.com,hr\n',
      /2 contacts imported/i,
    );
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));
    await screen.findByRole('heading', { name: 'Assign roles' });

    expect(screen.getByRole('combobox', { name: 'Role for worker@acme.com' })).toHaveTextContent(
      'Choose a role',
    );
    expect(screen.getByRole('combobox', { name: 'Role for manager@acme.com' })).toHaveTextContent(
      'HR',
    );
    expect(
      screen.getByText("1 row had a role that doesn't fit the selected facility — pick one below."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/some roles were cleared/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite 2 staff' })).toBeDisabled();
  });

  it('blanks an org-wide CSV pre-fill under a named facility and pluralises the warning', async () => {
    renderModal();
    await chooseFacility(/Northside Clinic/);
    await uploadCsv(
      'email,role\na@acme.com,hr\nb@acme.com,finance\nc@acme.com,nurse\n',
      /3 contacts imported/i,
    );
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));
    await screen.findByRole('heading', { name: 'Assign roles' });

    expect(screen.getByRole('combobox', { name: 'Role for a@acme.com' })).toHaveTextContent(
      'Choose a role',
    );
    expect(screen.getByRole('combobox', { name: 'Role for b@acme.com' })).toHaveTextContent(
      'Choose a role',
    );
    expect(screen.getByRole('combobox', { name: 'Role for c@acme.com' })).toHaveTextContent(
      'Nurse',
    );
    expect(
      screen.getByText(
        "2 rows had a role that doesn't fit the selected facility — pick one below.",
      ),
    ).toBeInTheDocument();
  });
});

describe('InviteStaffModal — partial-failure breakdown', () => {
  it('names the single shared reason when every refused row has the same one', async () => {
    mockCreateInvites.mockResolvedValue({
      success: true,
      results: [
        {
          email: 'a@acme.com',
          status: 'forbidden',
          message: 'Nurse must be invited to a specific facility.',
        },
        {
          email: 'b@acme.com',
          status: 'forbidden',
          message: 'Nurse must be invited to a specific facility.',
        },
      ],
    });
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');
    await setEveryRoleTo('Nurse');
    await userEvent.click(screen.getByRole('button', { name: 'Invite 2 staff' }));

    expect(
      await screen.findByText('2 not invited: Nurse must be invited to a specific facility.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Invite sent')).not.toBeInTheDocument();
  });

  it('falls back to the generic wording when refused rows carry different reasons', async () => {
    mockCreateInvites.mockResolvedValue({
      success: true,
      results: [
        {
          email: 'a@acme.com',
          status: 'forbidden',
          message: 'Nurse must be invited to a specific facility.',
        },
        {
          email: 'b@acme.com',
          status: 'forbidden',
          message: 'HR is organization-wide — invite with Global.',
        },
      ],
    });
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');
    await setEveryRoleTo('Nurse');
    await userEvent.click(screen.getByRole('button', { name: 'Invite 2 staff' }));

    expect(
      await screen.findByText('2 could not be invited with the selected role and facility'),
    ).toBeInTheDocument();
  });

  it('reports sent and refused rows together on a mixed batch and stays on the assign step', async () => {
    mockCreateInvites.mockResolvedValue({
      success: true,
      results: [
        { email: 'a@acme.com', status: 'sent' },
        {
          email: 'b@acme.com',
          status: 'forbidden',
          message: 'HR is organization-wide — invite with Global.',
        },
      ],
    });
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');
    await setEveryRoleTo('Nurse');
    await userEvent.click(screen.getByRole('button', { name: 'Invite 2 staff' }));

    expect(
      await screen.findByText(
        '1 invited • 1 not invited: HR is organization-wide — invite with Global.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Assign roles' })).toBeInTheDocument();
  });
});

describe('InviteStaffModal — step 2 accessibility', () => {
  it('ties Apply to all to the sub-copy through aria-describedby', async () => {
    renderModal();
    await goToAssignStep('a@acme.com');

    const apply = screen.getByRole('button', { name: 'Apply to all' });
    expect(apply).toHaveAccessibleDescription(
      'This will instantly apply the selected role to everyone in the list below',
    );
    const describedBy = apply.getAttribute('aria-describedby') as string;
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)).toHaveTextContent(
      'This will instantly apply the selected role to everyone in the list below',
    );
  });

  it('announces the applied role and staff count in a polite status region only after Apply', async () => {
    renderModal();
    await goToAssignStep('a@acme.com, b@acme.com');

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();

    await chooseBulkRole('Nurse');
    expect(status).toBeEmptyDOMElement();

    await userEvent.click(screen.getByRole('button', { name: 'Apply to all' }));
    expect(status).toHaveTextContent('Role set to Nurse for 2 staff');
  });

  it('keeps the subtitle as a screen-reader-only dialog description and labels the table columns', async () => {
    renderModal();
    await goToAssignStep('a@acme.com');

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Choose a role for each person, then send the invites.',
    );
    const table = screen.getByRole('table', { name: 'Staff to invite' });
    expect(within(table).getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Role' })).toBeInTheDocument();
  });
});

describe('InviteStaffModal — seat-cap gating', () => {
  it('disables Assign role and shows the exhausted-seats message when remainingSeats is 0', async () => {
    renderModal({ remainingSeats: 0, planName: 'Starter' });

    await userEvent.type(emailTextarea(), 'newworker@acme.com');

    expect(screen.getByText(/starter plan has no remaining worker seats/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^assign role$/i })).toBeDisabled();
  });

  it('enables Assign role and shows the remaining-seat count when seats are available', async () => {
    renderModal({ remainingSeats: 3, planName: 'Starter' });

    await userEvent.type(emailTextarea(), 'newworker@acme.com');

    expect(screen.getByText(/3 seats remaining on your starter plan/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^assign role$/i })).toBeEnabled();
  });

  it('names the step-1 primary button "Assign role" and disables it for a valid email when remainingSeats is 0', async () => {
    renderModal({ remainingSeats: 0, planName: 'Starter' });
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'newworker@acme.com');

    const button = screen.getByRole('button', { name: 'Assign role' });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(screen.queryByRole('heading', { name: 'Assign roles' })).not.toBeInTheDocument();
  });

  it('shows no seat hint when the plan is unlimited (remainingSeats: null)', async () => {
    renderModal({ remainingSeats: null });

    await userEvent.type(emailTextarea(), 'newworker@acme.com');

    expect(screen.queryByText(/seats? remaining/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^assign role$/i })).toBeEnabled();
  });
});

describe('InviteStaffModal — no-op guard', () => {
  it('does not call createInvites while roles are unassigned', async () => {
    renderModal();
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /^assign role$/i }));

    // The step-2 CTA is disabled, so the action is never reached.
    await waitFor(() => expect(screen.getByText('Assign roles')).toBeInTheDocument());
    expect(mockCreateInvites).not.toHaveBeenCalled();
  });
});
