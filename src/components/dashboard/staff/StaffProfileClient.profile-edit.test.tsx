/**
 * Gating tests for the two staff-profile editing affordances added for founder
 * answers Q2 and Q11.
 *
 * They are deliberately NOT one control and NOT one gate:
 *   - "Edit Profile"  → STAFF_PROFILE_ACTOR_ROLES (owner, admin, hr, supervisor)
 *   - "Change Role"   → ROLE_CHANGE_ACTOR_ROLES  (owner, admin, hr)
 *
 * The supervisor is the case both lists exist for: Q2 gives them basic profile
 * editing in their own facility, while Q11 keeps re-roling with Owner/Admin/HR.
 * Collapsing the two gates would hand them a control `canChangeRole` refuses.
 * Clinical Director and Finance are view-only over Staff Management and get
 * neither (rbac-staff-view-only.spec.ts asserts the same absence end-to-end).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import StaffProfileClient from './StaffProfileClient';
import type { Role } from '@/types/next-auth';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('@/app/actions/certificate', () => ({
  getAdminWorkerCertificates: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/app/actions/staff', () => ({
  getEnrollmentQuizResult: vi.fn(),
  updateStaffDetails: vi.fn(),
  setStaffFacilities: vi.fn(),
}));

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

const VIEWER_ORG_USER_ID = 'ou-viewer';

function makeStaff(role = 'nurse', id = 'ou-1') {
  return {
    user: {
      id,
      name: 'Target User',
      email: 'target@example.com',
      avatarUrl: null,
      role,
      firstName: 'Target',
      lastName: 'User',
      facilityName: 'Akobo branch',
    },
    stats: { totalCourses: 0, completedCourses: 0, failedCourses: 0, activeCourses: 0 },
    enrollments: [],
  };
}

function renderProfile(viewerRole: string, staff = makeStaff()) {
  render(
    <StaffProfileClient
      staff={staff}
      viewerRole={viewerRole as Role}
      viewerOrganizationUserId={VIEWER_ORG_USER_ID}
      facilities={[]}
    />,
  );
}

const editProfile = () => screen.queryByRole('button', { name: 'Edit Profile' });
const changeRole = () => screen.queryByRole('button', { name: 'Change Role' });

describe('StaffProfileClient — Edit Profile affordance (Q2)', () => {
  it.each(['owner', 'admin', 'hr', 'supervisor'])('renders for %s', (role) => {
    renderProfile(role);

    expect(editProfile()).toBeInTheDocument();
  });

  it.each(['clinical_director', 'finance'])('is hidden for view-only %s', (role) => {
    renderProfile(role);

    expect(editProfile()).not.toBeInTheDocument();
  });

  // Founder ruling Q3/Q17 (2026-09-23): the system-assigned role IS the title,
  // so the header carries the role chip and no separate job-title line.
  it('identifies the member by role and facility, with no job-title line', () => {
    renderProfile('supervisor');

    expect(screen.getByText(/Nurse, Akobo branch/)).toBeInTheDocument();
    expect(screen.queryByText('Staff Nurse')).not.toBeInTheDocument();
  });

  it('opens the edit modal prefilled from the loaded member', async () => {
    const user = userEvent.setup();
    renderProfile('supervisor');

    await user.click(editProfile()!);

    expect(screen.getByRole('heading', { name: 'Edit profile' })).toBeInTheDocument();
    expect(screen.getByLabelText(/First name/)).toHaveValue('Target');
    expect(screen.getByLabelText(/Last name/)).toHaveValue('User');
    expect(screen.queryByLabelText(/Job title/i)).not.toBeInTheDocument();
  });
});

describe('StaffProfileClient — Change Role affordance (Q11)', () => {
  it.each(['owner', 'admin', 'hr'])('renders for %s', (role) => {
    renderProfile(role);

    expect(changeRole()).toBeInTheDocument();
  });

  // ⛔ The whole reason the two actor lists exist. A supervisor edits profiles
  // but is not in ROLE_CHANGE_ACTOR_ROLES, so this control must be ABSENT —
  // not disabled, not refused after the fact.
  it('is hidden for a supervisor, who sees Edit Profile but never re-roles anyone', () => {
    renderProfile('supervisor');

    expect(editProfile()).toBeInTheDocument();
    expect(changeRole()).not.toBeInTheDocument();
  });

  it.each(['clinical_director', 'finance'])('is hidden for view-only %s', (role) => {
    renderProfile(role);

    expect(changeRole()).not.toBeInTheDocument();
  });

  // `canChangeRole` refuses `target_not_reachable` here — owner is in no grant
  // list — so the button is absent rather than offered and then refused.
  it('is hidden on an owner’s profile, whose role no one may change', () => {
    renderProfile('admin', makeStaff('owner'));

    expect(changeRole()).not.toBeInTheDocument();
  });

  // HR cannot mint an Owner-equivalent seat, so it cannot reach an admin either.
  it('is hidden for HR on an admin’s profile', () => {
    renderProfile('hr', makeStaff('admin'));

    expect(changeRole()).not.toBeInTheDocument();
  });

  it('is hidden on the viewer’s own profile (`self_change`)', () => {
    renderProfile('hr', makeStaff('hr', VIEWER_ORG_USER_ID));

    expect(changeRole()).not.toBeInTheDocument();
    expect(editProfile()).toBeInTheDocument();
  });

  it('opens a role picker with Owner and Admin absent for HR', async () => {
    const user = userEvent.setup();
    renderProfile('hr');

    await user.click(changeRole()!);

    expect(screen.getByRole('heading', { name: 'Change role' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox'));
    const options = within(await screen.findByRole('listbox'));
    // Matched per OPTION, not against the listbox's whole text: a `^Owner`
    // regex on the container anchors at "MANAGERS" and passes vacuously.
    expect(options.getByRole('option', { name: /Facility Supervisor/ })).toBeInTheDocument();
    expect(options.queryByRole('option', { name: /^Owner/ })).not.toBeInTheDocument();
    expect(options.queryByRole('option', { name: /^Admin/ })).not.toBeInTheDocument();
  });
});
