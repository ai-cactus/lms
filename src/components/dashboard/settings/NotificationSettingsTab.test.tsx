/**
 * Tests for NotificationSettingsTab — the Summary Reports cadence radio group
 * plus the notification-categories matrix, saved via one "Save changes" button.
 *
 * The behavior under test is the partial-update rule the component's onSubmit
 * comment calls out: each of the two sections only writes when it is actually
 * dirty, so toggling one never blindly rewrites the other. Also covers the
 * always-on security row rendering locked/checked and excluded from the save
 * payload, and Cancel/Save enabled state tracking form dirtiness.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NotificationCategoryPreferenceMap } from '@/lib/notifications/catalog';

const { mockUpdateDigestFrequency, mockUpdateCategoryPreferences, mockRefresh } = vi.hoisted(
  () => ({
    mockUpdateDigestFrequency: vi.fn(),
    mockUpdateCategoryPreferences: vi.fn(),
    mockRefresh: vi.fn(),
  }),
);

vi.mock('@/app/actions/notification-settings', () => ({
  updateDigestFrequency: mockUpdateDigestFrequency,
  updateNotificationCategoryPreferences: mockUpdateCategoryPreferences,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

// jsdom has no ResizeObserver; Radix's RadioGroup (via useSize) needs one to mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import NotificationSettingsTab from './NotificationSettingsTab';

const CATEGORY_PREFERENCES: NotificationCategoryPreferenceMap = {
  training: { emailEnabled: false, inAppEnabled: true },
  documentation: { emailEnabled: true, inAppEnabled: true },
  workforce: { emailEnabled: false, inAppEnabled: true },
  reports: { emailEnabled: true, inAppEnabled: true },
  security: { emailEnabled: true, inAppEnabled: true },
};

function renderTab() {
  render(
    <NotificationSettingsTab digestFrequency="daily" categoryPreferences={CATEGORY_PREFERENCES} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotificationSettingsTab', () => {
  it('disables Save and Cancel until the form is dirty', () => {
    renderTab();

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('renders the security row locked, checked, and disabled', () => {
    renderTab();

    const emailLock = screen.getByRole('checkbox', { name: 'Security & Account email' });
    const inAppLock = screen.getByRole('checkbox', {
      name: 'Security & Account in-app notification',
    });
    expect(emailLock).toBeChecked();
    expect(emailLock).toBeDisabled();
    expect(inAppLock).toBeChecked();
    expect(inAppLock).toBeDisabled();
  });

  it('only calls updateDigestFrequency when just the cadence changed, leaving categories untouched', async () => {
    const user = userEvent.setup();
    mockUpdateDigestFrequency.mockResolvedValue({ success: true });
    renderTab();

    await user.click(screen.getByRole('radio', { name: /Weekly/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(mockUpdateDigestFrequency).toHaveBeenCalledWith({ frequency: 'weekly' });
    expect(mockUpdateCategoryPreferences).not.toHaveBeenCalled();
    expect(await screen.findByText('Notification settings updated.')).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('only calls updateNotificationCategoryPreferences when just a category changed, leaving cadence untouched', async () => {
    const user = userEvent.setup();
    mockUpdateCategoryPreferences.mockResolvedValue({ success: true });
    renderTab();

    await user.click(screen.getByRole('checkbox', { name: 'Training & Learning email' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(mockUpdateDigestFrequency).not.toHaveBeenCalled();
    expect(mockUpdateCategoryPreferences).toHaveBeenCalledTimes(1);
    const payload = mockUpdateCategoryPreferences.mock.calls[0][0].categories;
    expect(payload).toContainEqual({
      category: 'training',
      emailEnabled: true,
      inAppEnabled: true,
    });
    // The locked security category is never part of the writable payload.
    expect(payload.find((c: { category: string }) => c.category === 'security')).toBeUndefined();
  });

  it('shows the server error and does not reset the form on failure', async () => {
    const user = userEvent.setup();
    mockUpdateDigestFrequency.mockResolvedValue({ success: false, error: 'Forbidden' });
    renderTab();

    await user.click(screen.getByRole('radio', { name: /Weekly/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
    // Still dirty — Save remains enabled since the failed change was not committed.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('Cancel reverts an unsaved change and re-disables Save', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('radio', { name: /Weekly/ }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(mockUpdateDigestFrequency).not.toHaveBeenCalled();
  });
});
