/**
 * Tests for the dashboard's facility scope control: what the trigger reads, how
 * the palette is opened (click or ⌘K/Ctrl+K), and the URL each selection writes.
 * The palette's own behaviour is covered in FacilityScopePalette.test.tsx.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AccessibleFacility } from '@/lib/facility/scope';
import FacilityScopeSwitcher, {
  buildFacilityScopeHref,
  facilityScopeLabel,
} from './FacilityScopeSwitcher';

const { mockPush, mockSearchParams } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockSearchParams: { value: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/dashboard',
  useSearchParams: () => mockSearchParams.value,
}));

const FACILITIES: AccessibleFacility[] = [
  { id: 'fac-a', name: 'Northside Clinic', type: 'Behavioral Health', city: 'Denver' },
  { id: 'fac-b', name: 'Downtown Wellness Center', type: 'Primary Care', city: 'Denver' },
];

const trigger = () => screen.getByRole('button', { name: /Facility scope/ });

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams.value = new URLSearchParams();
});

describe('buildFacilityScopeHref', () => {
  it('drops the param entirely for an empty selection', () => {
    expect(buildFacilityScopeHref('/dashboard', '', [])).toBe('/dashboard');
  });

  it('writes a single id', () => {
    expect(buildFacilityScopeHref('/dashboard', '', ['fac-a'])).toBe('/dashboard?facility=fac-a');
  });

  it('writes a comparison as a readable comma-separated list', () => {
    expect(buildFacilityScopeHref('/dashboard', '', ['fac-a', 'fac-b'])).toBe(
      '/dashboard?facility=fac-a,fac-b',
    );
  });

  it('preserves unrelated params and replaces an existing scope', () => {
    expect(buildFacilityScopeHref('/dashboard', 'tab=risks&facility=fac-a', ['fac-b'])).toBe(
      '/dashboard?tab=risks&facility=fac-b',
    );
    expect(buildFacilityScopeHref('/dashboard', 'tab=risks&facility=fac-a', [])).toBe(
      '/dashboard?tab=risks',
    );
  });
});

describe('facilityScopeLabel', () => {
  it('reads "All Facilities" for an empty selection', () => {
    expect(facilityScopeLabel(FACILITIES, [])).toBe('All Facilities');
  });

  it('reads the facility name for a single selection', () => {
    expect(facilityScopeLabel(FACILITIES, ['fac-b'])).toBe('Downtown Wellness Center');
  });

  it('falls back to a count when the single id is not in the accessible list', () => {
    expect(facilityScopeLabel(FACILITIES, ['gone'])).toBe('1 facility selected');
  });

  it('counts a comparison', () => {
    expect(facilityScopeLabel(FACILITIES, ['fac-a', 'fac-b'])).toBe('2 facilities selected');
  });
});

describe('FacilityScopeSwitcher — trigger', () => {
  it.each([
    [[], 'All Facilities'],
    [['fac-a'], 'Northside Clinic'],
    [['fac-a', 'fac-b'], '2 facilities selected'],
  ])('labels %j as "%s"', (selectedFacilityIds, label) => {
    render(
      <FacilityScopeSwitcher facilities={FACILITIES} selectedFacilityIds={selectedFacilityIds} />,
    );

    expect(trigger()).toHaveTextContent(label);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the palette closed until it is opened', () => {
    render(<FacilityScopeSwitcher facilities={FACILITIES} selectedFacilityIds={[]} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('FacilityScopeSwitcher — opening the palette', () => {
  it('opens on click', async () => {
    const user = userEvent.setup();
    render(<FacilityScopeSwitcher facilities={FACILITIES} selectedFacilityIds={[]} />);

    // Held onto up front: an open dialog hides the rest of the page from the
    // accessibility tree, so the trigger is no longer queryable by role.
    const control = trigger();
    await user.click(control);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(control).toHaveAttribute('aria-expanded', 'true');
  });

  it.each([
    ['⌘K', '{Meta>}k{/Meta}'],
    ['Ctrl+K', '{Control>}k{/Control}'],
  ])('does NOT open on %s — the shortcut was removed by request', async (_label, keys) => {
    const user = userEvent.setup();
    render(<FacilityScopeSwitcher facilities={FACILITIES} selectedFacilityIds={[]} />);

    await user.keyboard(keys);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('FacilityScopeSwitcher — applying a selection', () => {
  it('routes to the org-wide dashboard when the selection is cleared', async () => {
    const user = userEvent.setup();
    mockSearchParams.value = new URLSearchParams('facility=fac-a');
    render(<FacilityScopeSwitcher facilities={FACILITIES} selectedFacilityIds={['fac-a']} />);

    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'All facilities' }));

    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('routes to a single facility scope', async () => {
    const user = userEvent.setup();
    render(<FacilityScopeSwitcher facilities={FACILITIES} selectedFacilityIds={[]} />);

    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: /Northside Clinic/ }));
    await user.click(screen.getByRole('button', { name: /Select 1 facility/ }));

    expect(mockPush).toHaveBeenCalledWith('/dashboard?facility=fac-a');
  });

  it('routes to a comparison of the selected facilities', async () => {
    const user = userEvent.setup();
    render(<FacilityScopeSwitcher facilities={FACILITIES} selectedFacilityIds={[]} />);

    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: /Northside Clinic/ }));
    await user.click(screen.getByRole('option', { name: /Downtown Wellness Center/ }));
    await user.click(screen.getByRole('button', { name: /Select 2 facilities/ }));

    expect(mockPush).toHaveBeenCalledWith('/dashboard?facility=fac-a,fac-b');
  });

  it('leaves the URL untouched when the palette is dismissed', async () => {
    const user = userEvent.setup();
    render(<FacilityScopeSwitcher facilities={FACILITIES} selectedFacilityIds={[]} />);

    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: /Northside Clinic/ }));
    await user.keyboard('{Escape}');

    expect(mockPush).not.toHaveBeenCalled();
  });
});
