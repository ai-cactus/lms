/**
 * Tests for the Manage|Learn segmented switcher rendered in both the admin and
 * worker sidebars. `enterLearnMode` is a 'use server' action — it is mocked
 * here so the component doesn't pull in next/headers, next-auth/jwt, @/auth,
 * @/lib/prisma and @/lib/audit (that plumbing has its own test coverage in
 * session-bridge.test.ts).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/app/actions/session-bridge', () => ({ enterLearnMode: vi.fn() }));

import SidebarModeSwitcher from './SidebarModeSwitcher';

describe('SidebarModeSwitcher — mode="manage"', () => {
  it('shows Manage as the active (non-interactive) segment', () => {
    render(<SidebarModeSwitcher mode="manage" />);

    const manageSegment = screen.getByText('Manage');
    expect(manageSegment.tagName).toBe('SPAN');
    expect(manageSegment).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('link', { name: 'Manage' })).not.toBeInTheDocument();
  });

  it('renders Learn as a submit button inside a form wired to enterLearnMode', () => {
    render(<SidebarModeSwitcher mode="manage" />);

    const learnButton = screen.getByRole('button', { name: 'Learn' });
    expect(learnButton).toHaveAttribute('type', 'submit');
    expect(learnButton).toHaveAttribute('aria-pressed', 'false');
    expect(learnButton.closest('form')).not.toBeNull();
  });
});

describe('SidebarModeSwitcher — mode="learn"', () => {
  it('shows Learn as the active (non-interactive) segment', () => {
    render(<SidebarModeSwitcher mode="learn" />);

    const learnSegment = screen.getByText('Learn');
    expect(learnSegment.tagName).toBe('SPAN');
    expect(learnSegment).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Learn' })).not.toBeInTheDocument();
  });

  it('renders Manage as a link back to /dashboard', () => {
    render(<SidebarModeSwitcher mode="learn" />);

    const manageLink = screen.getByRole('link', { name: 'Manage' });
    expect(manageLink).toHaveAttribute('href', '/dashboard');
    expect(manageLink).toHaveAttribute('aria-pressed', 'false');
  });
});
