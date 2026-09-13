/**
 * AssignPublishClient had no unit test file at all before this — the exact gap
 * that let the Due Date field sit hidden in role mode on a false premise ("role
 * targets never carry an absolute due date"). Covers: which fields render in
 * each mode (Due Date must render in BOTH now), the toggle labels, and that
 * each submit branch sends the deadline under the right key plus the
 * `dueWindowDays` round-trip (both paths write that column unconditionally, so
 * omitting it would silently clear an org's wizard-set window).
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UserRole } from '@/generated/prisma/enums';
import type { RoleTargetPickerMode } from '@/components/dashboard/enrollment/RoleTargetPicker';
import type { CourseAssignmentSettings } from '@/app/actions/enrollment';
import { isPastDeadlineChange, combineDateAndTime } from '@/lib/reminders/deadline';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The shared DatePicker portals a calendar to <body>; swap it for a plain input
// so these tests exercise the page's field wiring, not the picker's grid.
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// TimePicker gets the same treatment as DatePicker, for the same reason: it
// portals a real analog clock to <body> (see TimePicker.test.tsx for that
// component's own coverage), which these tests have no interest in driving.
// What matters HERE is the page's wiring — that a stored time-of-day hydrates
// into the field and an untouched field survives a re-save unchanged — and a
// plain controlled input proves that without the portal/positioning noise.
vi.mock('@/components/ui/TimePicker', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const { mockRoleTargetPicker } = vi.hoisted(() => ({ mockRoleTargetPicker: vi.fn() }));

vi.mock('@/components/dashboard/enrollment/RoleTargetPicker', () => ({
  __esModule: true,
  default: (props: {
    mode: RoleTargetPickerMode;
    selectedRoles: UserRole[];
    onSelectionChange: (roles: UserRole[]) => void;
  }) => {
    mockRoleTargetPicker(props);
    return (
      <button
        type="button"
        data-testid="role-target-picker"
        onClick={() => props.onSelectionChange(['nurse'] as UserRole[])}
      >
        Choose roles (stub)
      </button>
    );
  },
}));

const mockEnrollUsers = vi.fn();
const mockAssignCourseToRoles = vi.fn();

vi.mock('@/app/actions/enrollment', () => ({
  enrollUsers: (...args: unknown[]) => mockEnrollUsers(...args),
  assignCourseToRoles: (...args: unknown[]) => mockAssignCourseToRoles(...args),
}));

const mockPublishCourse = vi.fn();
vi.mock('@/app/actions/course', () => ({
  publishCourse: (...args: unknown[]) => mockPublishCourse(...args),
}));

import AssignPublishClient from './AssignPublishClient';

function existingSettings(
  overrides: Partial<CourseAssignmentSettings> = {},
): CourseAssignmentSettings {
  return {
    assignmentId: 'assign-1',
    scheduleAt: null,
    dueAt: null,
    dueWindowDays: null,
    renewalCycle: 'annual',
    remindersEnabled: true,
    targetRole: null,
    targetRoles: [],
    facilityScoped: false,
    enrolledCount: 0,
    stages: [],
    ...overrides,
  } as unknown as CourseAssignmentSettings;
}

function renderClient(props: Partial<React.ComponentProps<typeof AssignPublishClient>> = {}) {
  return render(
    <AssignPublishClient
      courseId="course-1"
      courseTitle="Infection Control"
      courseStatus="published"
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnrollUsers.mockResolvedValue({
    success: [],
    failed: [],
    newInvited: [],
    refusedReason: null,
  });
  mockAssignCourseToRoles.mockResolvedValue({
    assignmentId: 'assign-1',
    holderCount: 1,
    enrolled: 1,
    alreadyEnrolled: 0,
    failed: 0,
    refusedReason: null,
    targetRoles: ['nurse'],
  });
  mockPublishCourse.mockResolvedValue({ success: true });
});

describe('AssignPublishClient — mode toggle', () => {
  it('labels the toggle buttons "Specific people" and "Roles"', () => {
    renderClient();

    expect(screen.getByRole('button', { name: 'Specific people' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Roles' })).toBeInTheDocument();
  });

  it('defaults to people mode with no existing role targets', () => {
    renderClient();

    expect(screen.getByRole('button', { name: 'Specific people' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByTestId('role-target-picker')).not.toBeInTheDocument();
  });

  it('defaults to role mode when existingSettings already targets roles', () => {
    renderClient({
      existingSettings: existingSettings({ targetRoles: ['nurse'] as UserRole[] }),
    });

    expect(screen.getByRole('button', { name: 'Roles' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('role-target-picker')).toBeInTheDocument();
  });
});

describe('AssignPublishClient — Due Date renders in both modes', () => {
  it('renders Due Date in people mode', () => {
    renderClient();

    expect(screen.getByRole('heading', { name: 'Due Date' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Select due date')).toBeInTheDocument();
  });

  it('renders Due Date in role mode too — the fix under test', async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole('button', { name: 'Roles' }));

    expect(screen.getByRole('heading', { name: 'Due Date' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Select due date')).toBeInTheDocument();
  });

  it('still renders the people entry field only in people mode', async () => {
    const user = userEvent.setup();
    renderClient();

    expect(screen.getByPlaceholderText('Add people, emails or names')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Roles' }));

    expect(screen.queryByPlaceholderText('Add people, emails or names')).not.toBeInTheDocument();
    expect(screen.getByTestId('role-target-picker')).toBeInTheDocument();
  });
});

describe('AssignPublishClient — AssigneesInput host wiring', () => {
  it('the Invite button commits an uncommitted draft via commitDraft()', async () => {
    const user = userEvent.setup();
    renderClient();

    // Typed but never confirmed with Enter/Tab/comma/space.
    await user.type(screen.getByPlaceholderText('Add people, emails or names'), 'worker@test.com');
    expect(screen.queryByText('worker@test.com')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Invite' }));

    expect(screen.getByText('worker@test.com')).toBeInTheDocument();
  });

  it('exposes the bulk-import CSV control in people mode', () => {
    renderClient();

    expect(screen.getByText('Click to upload .csv file instead')).toBeInTheDocument();
    expect(screen.getByText('Download sample .csv template')).toBeInTheDocument();
  });
});

describe('AssignPublishClient — submit payloads', () => {
  it('people mode sends dueAt (not dueDate) and dueWindowDays:null with no existing settings', async () => {
    const user = userEvent.setup();
    renderClient();

    await user.type(screen.getByPlaceholderText('Add people, emails or names'), 'worker@test.com,');
    await user.type(screen.getByPlaceholderText('Select due date'), '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockEnrollUsers).toHaveBeenCalledTimes(1));
    const [, , settings] = mockEnrollUsers.mock.calls[0];
    expect(settings).toEqual(
      expect.objectContaining({
        dueAt: new Date('2026-12-01'),
        dueWindowDays: null,
      }),
    );
    expect(settings).not.toHaveProperty('dueDate');
  });

  it('role mode sends dueDate (not dueAt) to assignCourseToRoles', async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole('button', { name: 'Roles' }));
    await user.click(screen.getByTestId('role-target-picker')); // selects ['nurse']
    await user.type(screen.getByPlaceholderText('Select due date'), '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockAssignCourseToRoles).toHaveBeenCalledTimes(1));
    const [, , settings] = mockAssignCourseToRoles.mock.calls[0];
    expect(settings).toEqual(
      expect.objectContaining({
        dueDate: new Date('2026-12-01'),
        dueWindowDays: null,
      }),
    );
    expect(settings).not.toHaveProperty('dueAt');
  });

  it('round-trips a wizard-set dueWindowDays through the people-mode submit instead of nulling it', async () => {
    const user = userEvent.setup();
    renderClient({ existingSettings: existingSettings({ dueWindowDays: 45 }) });

    await user.type(screen.getByPlaceholderText('Add people, emails or names'), 'worker@test.com,');
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockEnrollUsers).toHaveBeenCalledTimes(1));
    const [, , settings] = mockEnrollUsers.mock.calls[0];
    expect(settings).toEqual(expect.objectContaining({ dueWindowDays: 45 }));
  });

  it('round-trips a wizard-set dueWindowDays through the role-mode submit instead of nulling it', async () => {
    const user = userEvent.setup();
    renderClient({
      existingSettings: existingSettings({
        dueWindowDays: 45,
        targetRoles: ['nurse'] as UserRole[],
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockAssignCourseToRoles).toHaveBeenCalledTimes(1));
    const [, , settings] = mockAssignCourseToRoles.mock.calls[0];
    expect(settings).toEqual(expect.objectContaining({ dueWindowDays: 45 }));
  });
});

/**
 * Priority 1 / Priority 2: `toDateInput()` used to drop a stored deadline's
 * time-of-day (`new Date(v).toISOString().slice(0, 10)`), so an admin who
 * re-saved this page without touching the Due Date — adding one more person,
 * say — silently rewrote a wizard-set 5pm deadline to 00:00 UTC. Combined with
 * #607's `isPastDeadlineChange` (a past deadline is refused only when it
 * CHANGES the stored one), that truncation meant ANY past non-midnight
 * deadline was refused on re-save with "The deadline must be in the future"
 * even though nothing changed — the live bug on `dev` this phase fixes.
 *
 * `isPastDeadlineChange` itself is real here (not mocked) — the tests below
 * assert both that the component sends the exact stored timestamp back AND
 * that the real business-rule function then reads that as "unchanged".
 *
 * A fixed clock avoids the fixture-date-rot trap: "2026-08-01" must stay in
 * the past and "2026-10-31"/"2026-12-01" must stay in the future for as long
 * as this file exists.
 */
describe('AssignPublishClient — Priority 1: an unchanged re-save must not turn a past deadline into a refusal', () => {
  beforeEach(() => {
    // Only Date is faked — RTL's waitFor and userEvent's own scheduling still
    // need real timers, or they hang waiting on a clock nothing advances.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('role mode: re-saving with an untouched, past, non-midnight stored deadline sends back the SAME timestamp — accepted where the truncation bug would have refused it', async () => {
    const storedDueAt = new Date('2026-08-01T17:00:00.000Z'); // past, 5pm UTC — not midnight
    renderClient({
      existingSettings: existingSettings({
        dueAt: storedDueAt,
        targetRoles: ['nurse'] as UserRole[],
      }),
    });

    // Hydrated straight from existingSettings, untouched by the test.
    expect(screen.getByPlaceholderText('Select due date')).toHaveValue('2026-08-01');
    expect(screen.getByPlaceholderText('Select due time')).toHaveValue('5:00 PM');

    fireEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockAssignCourseToRoles).toHaveBeenCalledTimes(1));
    const [, , settings] = mockAssignCourseToRoles.mock.calls[0];
    // Sent as the wizard sends it: date + time separately, joined server-side.
    expect(settings.dueDate).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    expect(settings.dueTime).toBe('5:00 PM');

    const submittedDueAt = combineDateAndTime(settings.dueDate, settings.dueTime);
    expect(submittedDueAt).toEqual(storedDueAt);
    // The exact D-F comparison the assign actions make: unchanged, so allowed.
    expect(isPastDeadlineChange(submittedDueAt as Date, storedDueAt)).toBe(false);
  });

  it('people mode: adding a person without touching an untouched, past, non-midnight stored deadline sends back the SAME timestamp', async () => {
    const storedDueAt = new Date('2026-08-01T17:00:00.000Z');
    renderClient({ existingSettings: existingSettings({ dueAt: storedDueAt }) });

    fireEvent.change(screen.getByPlaceholderText('Add people, emails or names'), {
      target: { value: 'worker@test.com,' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockEnrollUsers).toHaveBeenCalledTimes(1));
    const [, , settings] = mockEnrollUsers.mock.calls[0];
    expect(settings.dueAt).toEqual(storedDueAt);
    expect(isPastDeadlineChange(settings.dueAt as Date, storedDueAt)).toBe(false);
  });

  it('a stored past deadline at exactly midnight UTC is also unaffected — still accepted, as it already was', async () => {
    const storedDueAt = new Date('2026-08-01T00:00:00.000Z'); // past, already midnight
    renderClient({
      existingSettings: existingSettings({
        dueAt: storedDueAt,
        targetRoles: ['nurse'] as UserRole[],
      }),
    });

    // formatTimeOfDay(midnight) is "12:00 AM", not "" — confirm the field
    // hydrates to a real value rather than reading as untouched/empty.
    expect(screen.getByPlaceholderText('Select due time')).toHaveValue('12:00 AM');

    fireEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockAssignCourseToRoles).toHaveBeenCalledTimes(1));
    const [, , settings] = mockAssignCourseToRoles.mock.calls[0];
    const submittedDueAt = combineDateAndTime(settings.dueDate, settings.dueTime);
    expect(submittedDueAt).toEqual(storedDueAt);
    expect(isPastDeadlineChange(submittedDueAt as Date, storedDueAt)).toBe(false);
  });

  it('genuinely CHANGING a past deadline to a different past date/time is still a change — D-F must keep refusing that', async () => {
    const storedDueAt = new Date('2026-08-01T17:00:00.000Z');
    renderClient({
      existingSettings: existingSettings({
        dueAt: storedDueAt,
        targetRoles: ['nurse'] as UserRole[],
      }),
    });

    // Actually edit the date field to a different (still past) day; the time
    // field is left at its hydrated "5:00 PM".
    const dateInput = screen.getByPlaceholderText('Select due date');
    fireEvent.change(dateInput, { target: { value: '2026-08-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockAssignCourseToRoles).toHaveBeenCalledTimes(1));
    const [, , settings] = mockAssignCourseToRoles.mock.calls[0];
    const submittedDueAt = combineDateAndTime(settings.dueDate, settings.dueTime);
    expect(submittedDueAt).toEqual(new Date('2026-08-15T17:00:00.000Z'));
    // Different from what is stored — and still in the past — so this phase
    // must not have weakened D-F: it is still reported as a change.
    expect(isPastDeadlineChange(submittedDueAt as Date, storedDueAt)).toBe(true);
  });

  it('a future deadline is unaffected regardless of what is currently stored', async () => {
    const storedDueAt = new Date('2026-08-01T17:00:00.000Z'); // past
    renderClient({ existingSettings: existingSettings({ dueAt: storedDueAt }) });

    fireEvent.change(screen.getByPlaceholderText('Select due date'), {
      target: { value: '2026-12-01' },
    });
    fireEvent.change(screen.getByPlaceholderText('Add people, emails or names'), {
      target: { value: 'worker@test.com,' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockEnrollUsers).toHaveBeenCalledTimes(1));
    const [, , settings] = mockEnrollUsers.mock.calls[0];
    // The time field kept its hydrated "5:00 PM" — only the date changed.
    expect(settings.dueAt).toEqual(new Date('2026-12-01T17:00:00.000Z'));
    expect(isPastDeadlineChange(settings.dueAt as Date, storedDueAt)).toBe(false);
  });
});

/**
 * Priority 2: the truncation itself, independent of the D-F interaction above
 * — a stored deadline/schedule must survive an untouched re-save exactly,
 * including a time of day that a past-deadline check would never exercise
 * (a future date, well clear of "now").
 */
describe('AssignPublishClient — Priority 2: existingSettings.dueAt / scheduleAt survive a re-save without truncation', () => {
  beforeEach(() => {
    // Only Date is faked — RTL's waitFor and userEvent's own scheduling still
    // need real timers, or they hang waiting on a clock nothing advances.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const STORED_DUE_AT = new Date('2026-10-31T17:00:00.000Z');
  const STORED_SCHEDULE_AT = new Date('2026-10-01T09:15:00.000Z');

  it('people mode: enrollUsers receives the exact stored dueAt/scheduleAt Date objects, not midnight-truncated ones', async () => {
    renderClient({
      existingSettings: existingSettings({ dueAt: STORED_DUE_AT, scheduleAt: STORED_SCHEDULE_AT }),
    });

    expect(screen.getByPlaceholderText('Select due time')).toHaveValue('5:00 PM');
    expect(screen.getByPlaceholderText('Select time')).toHaveValue('9:15 AM');

    fireEvent.change(screen.getByPlaceholderText('Add people, emails or names'), {
      target: { value: 'worker@test.com,' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockEnrollUsers).toHaveBeenCalledTimes(1));
    const [, , settings] = mockEnrollUsers.mock.calls[0];
    expect(settings.dueAt).toEqual(STORED_DUE_AT);
    expect(settings.scheduleAt).toEqual(STORED_SCHEDULE_AT);
  });

  it('role mode: assignCourseToRoles receives dueDate/dueTime SEPARATELY (not pre-joined), and the join reconstructs the exact stored dueAt', async () => {
    renderClient({
      existingSettings: existingSettings({
        dueAt: STORED_DUE_AT,
        scheduleAt: STORED_SCHEDULE_AT,
        targetRoles: ['nurse'] as UserRole[],
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockAssignCourseToRoles).toHaveBeenCalledTimes(1));
    const [, , settings] = mockAssignCourseToRoles.mock.calls[0];

    // dueDate/dueTime travel as two separate fields for this action — never
    // pre-combined client-side, since assignCourseToRoles pairs them itself.
    expect(settings).not.toHaveProperty('dueAt');
    expect(settings.dueDate).toEqual(new Date('2026-10-31T00:00:00.000Z'));
    expect(settings.dueTime).toBe('5:00 PM');
    expect(combineDateAndTime(settings.dueDate, settings.dueTime)).toEqual(STORED_DUE_AT);

    // scheduleAt IS combined client-side for both modes (assignCourseToRoles
    // takes one absolute scheduleAt, unlike its two-part dueDate/dueTime).
    expect(settings.scheduleAt).toEqual(STORED_SCHEDULE_AT);
  });
});

/**
 * Phase 5 (D-B): the page lost its per-stage "Advanced reminder schedule"
 * editor and now speaks the wizard's "N days before" vocabulary via the shared
 * `ReminderLadderInput`. These tests cover the page's OWN wiring of that
 * control — hydration from a stored ladder (including an org's custom
 * escalation offsets, which must never surface as an editable row here) and
 * the submit payload shape. `stageRowsToReminderDays`/`reminderDaysToStageRows`
 * themselves are real here (not mocked) — see reminder-ladder.test.ts and
 * assignment.reminder-stages.test.ts for their own dedicated coverage, and
 * assignment.reminder-ladder-sink-safety.test.ts for the sink-level proof that
 * an org's custom escalation offsets survive a save from this page.
 */
describe('AssignPublishClient — Priority 4: reminder-ladder hydration and submit shape', () => {
  it('a fresh course with no existingSettings prefills the DEFAULT_WIZARD_REMINDER_DAYS cadence (14, 3, 0), not an empty ladder', () => {
    renderClient();

    expect(screen.getByLabelText('Reminder 1 days before deadline')).toHaveValue(14);
    expect(screen.getByLabelText('Reminder 2 days before deadline')).toHaveValue(3);
    expect(screen.getByLabelText('Reminder 3 days before deadline')).toHaveValue(0);
  });

  it('hydrates from a stored ladder that also carries custom escalation offsets — only the three worker rows ever render, never the escalation ones', () => {
    renderClient({
      existingSettings: existingSettings({
        stages: [
          { stage: 'FRIENDLY_REMINDER', offsetDays: -21, enabled: true, channels: ['email'] },
          { stage: 'URGENT_REMINDER', offsetDays: -5, enabled: true, channels: ['email'] },
          { stage: 'DAY_OF_DEADLINE', offsetDays: 0, enabled: true, channels: ['email'] },
          // Custom offsets outside the wizard's vocabulary — must not surface
          // as a 4th/5th row, and must not shift/replace the three above.
          { stage: 'GRACE_SOFT_ESCALATION', offsetDays: 10, enabled: true, channels: ['email'] },
          { stage: 'HARD_ESCALATION', offsetDays: 12, enabled: true, channels: ['email'] },
        ],
      }),
    });

    expect(screen.getByLabelText('Reminder 1 days before deadline')).toHaveValue(21);
    expect(screen.getByLabelText('Reminder 2 days before deadline')).toHaveValue(5);
    expect(screen.getByLabelText('Reminder 3 days before deadline')).toHaveValue(0);
    expect(screen.queryByLabelText('Reminder 4 days before deadline')).not.toBeInTheDocument();
  });

  it('people mode submits reminderDaysBefore and no stages key at all', async () => {
    const user = userEvent.setup();
    renderClient();

    await user.type(screen.getByPlaceholderText('Add people, emails or names'), 'worker@test.com,');
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockEnrollUsers).toHaveBeenCalledTimes(1));
    const [, , settings] = mockEnrollUsers.mock.calls[0];
    expect(settings).toEqual(expect.objectContaining({ reminderDaysBefore: [14, 3, 0] }));
    expect(settings).not.toHaveProperty('stages');
  });

  it('role mode submits reminderDaysBefore and no stages key at all', async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole('button', { name: 'Roles' }));
    await user.click(screen.getByTestId('role-target-picker'));
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockAssignCourseToRoles).toHaveBeenCalledTimes(1));
    const [, , settings] = mockAssignCourseToRoles.mock.calls[0];
    expect(settings).toEqual(expect.objectContaining({ reminderDaysBefore: [14, 3, 0] }));
    expect(settings).not.toHaveProperty('stages');
  });

  it('a stored assignment whose ladder already has no wizard-stage rows hydrates to an EMPTY control (not the fresh-course default) and submits reminderDaysBefore: []', async () => {
    const user = userEvent.setup();
    // existingSettings is non-null (an assignment DOES exist), but its stored
    // stages carry no enabled wizard-vocabulary row — e.g. every worker
    // reminder was previously disabled. This must render 0 rows, not silently
    // fall back to the fresh-course [14, 3, 0] default (that fallback is only
    // for `existingSettings === null`, per stageRowsToReminderDays vs.
    // DEFAULT_WIZARD_REMINDER_DAYS in the component's own ternary).
    renderClient({ existingSettings: existingSettings({ stages: [] }) });

    expect(screen.queryByLabelText(/Reminder \d+ days before deadline/)).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Add people, emails or names'), 'worker@test.com,');
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockEnrollUsers).toHaveBeenCalledTimes(1));
    const [, , settings] = mockEnrollUsers.mock.calls[0];
    // Deliberate meaning per D-B: [] disables exactly the three worker stages
    // and says nothing about grace/overdue — see
    // assignment.reminder-ladder-sink-safety.test.ts for the sink-level proof
    // that the escalation stages are left untouched by this exact payload.
    expect(settings.reminderDaysBefore).toEqual([]);
  });

  it('removing every row by hand on an otherwise-prefilled ladder also submits reminderDaysBefore: []', async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole('button', { name: 'Remove reminder 3' }));
    await user.click(screen.getByRole('button', { name: 'Remove reminder 2' }));
    await user.click(screen.getByRole('button', { name: 'Remove reminder 1' }));
    expect(screen.queryByLabelText(/Reminder \d+ days before deadline/)).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Add people, emails or names'), 'worker@test.com,');
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockEnrollUsers).toHaveBeenCalledTimes(1));
    const [, , settings] = mockEnrollUsers.mock.calls[0];
    expect(settings.reminderDaysBefore).toEqual([]);
  });
});
