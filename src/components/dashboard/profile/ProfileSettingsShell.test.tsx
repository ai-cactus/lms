/**
 * The Profile Settings frame (Figma 15629:122166 and siblings) is shared by both
 * profile surfaces.
 *
 * `/dashboard/profile` already implemented this design while `/worker/profile`
 * still carried the pre-redesign shell — uppercase underlined tabs rendered as
 * plain `div`s. The SAME Change Password and 2FA panels therefore looked wrong
 * on the worker page purely because of what surrounded them. One shell means a
 * later change to the frame cannot fix one surface and miss the other.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import ProfileSettingsShell from './ProfileSettingsShell';

const NAV = [
  { key: 'profile' as const, label: 'My Profile' },
  { key: 'password' as const, label: 'Change Password' },
  { key: '2fa' as const, label: 'Two-factor Authentication' },
];

function renderShell(overrides: Partial<React.ComponentProps<typeof ProfileSettingsShell>> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <ProfileSettingsShell
      backHref="/worker"
      navItems={NAV}
      activeKey="password"
      onSelect={onSelect}
      {...overrides}
    >
      <p>Panel body</p>
    </ProfileSettingsShell>,
  );
  return { ...utils, onSelect };
}

describe('ProfileSettingsShell', () => {
  it('renders the design’s Back link and title, pointing wherever the surface says', () => {
    renderShell({ backHref: '/dashboard' });

    expect(screen.getByRole('link', { name: /back/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('heading', { name: 'Profile Settings' })).toBeInTheDocument();
  });

  it('renders the nav as real tabs, not clickable divs', () => {
    renderShell();

    // The worker page's old tabs were <div onClick>: unreachable by keyboard and
    // invisible to assistive tech. These are buttons with tab semantics.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'My Profile',
      'Change Password',
      'Two-factor Authentication',
    ]);
    for (const tab of tabs) expect(tab.tagName).toBe('BUTTON');
  });

  it('marks only the active pill selected and styles it', () => {
    renderShell({ activeKey: 'password' });

    const active = screen.getByRole('tab', { name: 'Change Password' });
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(active.className).toContain('bg-primary/10');
    expect(screen.getByRole('tab', { name: 'My Profile' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('reports the chosen section to the caller', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderShell();

    await user.click(screen.getByRole('tab', { name: 'Two-factor Authentication' }));

    expect(onSelect).toHaveBeenCalledWith('2fa');
  });

  it('is reachable by keyboard', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderShell();

    await user.tab(); // the Back link
    await user.tab(); // first pill
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('profile');
  });

  it('wires the panel to the active tab for assistive tech', () => {
    renderShell({ activeKey: '2fa' });

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'profile-tab-2fa');
    expect(panel).toHaveTextContent('Panel body');
  });
});
