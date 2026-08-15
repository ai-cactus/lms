/**
 * Tests for the "Who is this course for?" wizard step.
 *
 * The step writes two fields into the wizard draft — `audience` and
 * `audienceRoles` — and owns the Next gate for itself via
 * `isAudienceSelectionValid`. The role catalog is the real RBAC one, so the grid
 * is asserted against `ALL_ROLES` rather than a hard-coded label list.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import Step3Audience, { isAudienceSelectionValid } from './Step3Audience';
import { ALL_ROLES, getRoleDisplayName } from '@/lib/rbac/role-utils';
import { CourseWizardData } from '@/types/course';
import { WIZARD_FORM_DATA } from './wizardTestData';

function renderStep(overrides: Partial<CourseWizardData> = {}) {
  const onChange = vi.fn();
  render(<Step3Audience data={{ ...WIZARD_FORM_DATA, ...overrides }} onChange={onChange} />);
  return { onChange };
}

describe('isAudienceSelectionValid', () => {
  it('accepts "general" regardless of the role selection', () => {
    expect(isAudienceSelectionValid({ audience: 'general', audienceRoles: [] })).toBe(true);
  });

  it('rejects "specific" until at least one role is picked', () => {
    expect(isAudienceSelectionValid({ audience: 'specific', audienceRoles: [] })).toBe(false);
    expect(isAudienceSelectionValid({ audience: 'specific', audienceRoles: ['nurse'] })).toBe(true);
  });
});

describe('Step3Audience', () => {
  it('renders both audience options with General selected by default', () => {
    renderStep();

    expect(screen.getByRole('radio', { name: /General/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Specific Roles/ })).not.toBeChecked();
  });

  it('hides the role grid until "Specific Roles" is chosen', () => {
    renderStep();

    expect(screen.queryByText('Select roles')).not.toBeInTheDocument();
  });

  it('reports the audience change when "Specific Roles" is picked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep();

    await user.click(screen.getByRole('radio', { name: /Specific Roles/ }));

    expect(onChange).toHaveBeenCalledWith('audience', 'specific');
  });

  it('lists every RBAC role once the audience is "specific"', () => {
    renderStep({ audience: 'specific' });

    expect(screen.getByText('Select roles')).toBeInTheDocument();
    for (const role of ALL_ROLES) {
      expect(screen.getByRole('checkbox', { name: getRoleDisplayName(role) })).toBeInTheDocument();
    }
  });

  it('adds a ticked role to audienceRoles', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ audience: 'specific' });

    await user.click(screen.getByRole('checkbox', { name: getRoleDisplayName('nurse') }));

    expect(onChange).toHaveBeenCalledWith('audienceRoles', ['nurse']);
  });

  it('keeps audienceRoles in catalog order when roles are ticked out of order', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ audience: 'specific', audienceRoles: ['nurse'] });

    await user.click(screen.getByRole('checkbox', { name: getRoleDisplayName('admin') }));

    expect(onChange).toHaveBeenCalledWith('audienceRoles', ['admin', 'nurse']);
  });

  it('removes an unticked role from audienceRoles', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ audience: 'specific', audienceRoles: ['nurse', 'hr'] });

    await user.click(screen.getByRole('checkbox', { name: getRoleDisplayName('nurse') }));

    expect(onChange).toHaveBeenCalledWith('audienceRoles', ['hr']);
  });

  it('selects every role from the "Select all" link', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ audience: 'specific' });

    await user.click(screen.getByRole('button', { name: 'Select all' }));

    expect(onChange).toHaveBeenCalledWith('audienceRoles', [...ALL_ROLES]);
  });

  it('clears the selection once every role is already selected', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ audience: 'specific', audienceRoles: [...ALL_ROLES] });

    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onChange).toHaveBeenCalledWith('audienceRoles', []);
  });
});
