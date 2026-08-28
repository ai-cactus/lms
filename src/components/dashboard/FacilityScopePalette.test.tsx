/**
 * Tests for the facility scope palette: search filtering, chip/row selection,
 * the three footer states (global / drill-down / compare), the keyboard
 * contract (arrows navigate, space selects, enter applies, escape discards)
 * and the close control (#22 — an actual close button, not the literal text
 * "esc"; the Escape *key* itself stays Radix's own concern and is covered
 * separately below).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AccessibleFacility } from '@/lib/facility/scope';
import FacilityScopePalette, { filterFacilities, toggleFacilityId } from './FacilityScopePalette';

const FACILITIES: AccessibleFacility[] = [
  { id: 'fac-a', name: 'Northside Clinic', type: 'Behavioral Health', city: 'Denver' },
  { id: 'fac-b', name: 'Downtown Wellness Center', type: 'Primary Care', city: 'Denver' },
  { id: 'fac-c', name: 'Lakeside Pediatrics', type: 'Pediatric Care', city: 'Lakewood' },
];

const COMPLETION = { 'fac-a': 96, 'fac-b': 72 };

function renderPalette(selectedFacilityIds: string[] = []) {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <FacilityScopePalette
      open
      onOpenChange={onOpenChange}
      facilities={FACILITIES}
      selectedFacilityIds={selectedFacilityIds}
      completionPercentByFacilityId={COMPLETION}
      onApply={onApply}
    />,
  );
  return { onApply, onOpenChange };
}

const rows = () => screen.getAllByRole('option');
const row = (name: string) => screen.getByRole('option', { name: new RegExp(name) });
const chip = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('filterFacilities', () => {
  it('returns every facility for an empty or whitespace query', () => {
    expect(filterFacilities(FACILITIES, '')).toEqual(FACILITIES);
    expect(filterFacilities(FACILITIES, '   ')).toEqual(FACILITIES);
  });

  it('matches on name, case-insensitively', () => {
    expect(filterFacilities(FACILITIES, 'lakeside')).toEqual([FACILITIES[2]]);
  });

  it('matches on type and city too', () => {
    expect(filterFacilities(FACILITIES, 'Primary Care')).toEqual([FACILITIES[1]]);
    expect(filterFacilities(FACILITIES, 'denver')).toEqual([FACILITIES[0], FACILITIES[1]]);
  });

  it('returns [] when nothing matches', () => {
    expect(filterFacilities(FACILITIES, 'zzz')).toEqual([]);
  });
});

describe('toggleFacilityId', () => {
  it('adds an unselected id and removes a selected one, leaving the rest alone', () => {
    expect(toggleFacilityId(['fac-a'], 'fac-b')).toEqual(['fac-a', 'fac-b']);
    expect(toggleFacilityId(['fac-a', 'fac-b'], 'fac-a')).toEqual(['fac-b']);
  });
});

describe('FacilityScopePalette — rendering', () => {
  it('lists every facility with its subtitle and training completion percentage', () => {
    renderPalette();

    expect(rows()).toHaveLength(3);
    const northside = row('Northside Clinic');
    expect(within(northside).getByText('Behavioral Health · Denver')).toBeInTheDocument();
    expect(within(northside).getByText('96%')).toBeInTheDocument();
  });

  it('renders an em dash when a facility has no completion figure', () => {
    renderPalette();

    expect(within(row('Lakeside Pediatrics')).getByText('—')).toBeInTheDocument();
  });

  it('marks "All facilities" as the active chip while nothing is selected', () => {
    renderPalette();

    expect(chip('All facilities')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Northside Clinic')).toHaveAttribute('aria-pressed', 'false');
  });

  it('starts from the scope it was opened with', () => {
    renderPalette(['fac-a', 'fac-c']);

    expect(chip('All facilities')).toHaveAttribute('aria-pressed', 'false');
    expect(row('Northside Clinic')).toHaveAttribute('aria-selected', 'true');
    expect(row('Downtown Wellness Center')).toHaveAttribute('aria-selected', 'false');
    expect(row('Lakeside Pediatrics')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('FacilityScopePalette — search', () => {
  it('filters the rows by the query', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByRole('combobox'), 'lakeside');

    expect(rows()).toHaveLength(1);
    expect(row('Lakeside Pediatrics')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches, leaving the chips available', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByRole('combobox'), 'zzz');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No facilities match your search')).toBeInTheDocument();
    expect(chip('Northside Clinic')).toBeInTheDocument();
  });
});

describe('FacilityScopePalette — selection', () => {
  it('toggles a facility when its row is clicked', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.click(row('Northside Clinic'));
    expect(row('Northside Clinic')).toHaveAttribute('aria-selected', 'true');

    await user.click(row('Northside Clinic'));
    expect(row('Northside Clinic')).toHaveAttribute('aria-selected', 'false');
  });

  it('mirrors row selection in the chips', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.click(row('Northside Clinic'));

    expect(chip('Northside Clinic')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('All facilities')).toHaveAttribute('aria-pressed', 'false');
  });

  it('selects from a chip too', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.click(chip('Lakeside Pediatrics'));

    expect(row('Lakeside Pediatrics')).toHaveAttribute('aria-selected', 'true');
  });

  it('clears the whole selection from the "All facilities" chip', async () => {
    const user = userEvent.setup();
    renderPalette(['fac-a', 'fac-b']);

    await user.click(chip('All facilities'));

    expect(rows().every((option) => option.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(chip('All facilities')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('FacilityScopePalette — footer', () => {
  it('shows the same button disabled while nothing is selected', () => {
    renderPalette();

    expect(screen.getByRole('button', { name: /Select facilities/ })).toBeDisabled();
  });

  it('enables "Select 1 facility" for exactly one selection', () => {
    renderPalette(['fac-a']);

    expect(screen.getByRole('button', { name: /Select 1 facility/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Compare/ })).not.toBeInTheDocument();
  });

  it('offers "Select N facilities" from two selections up', async () => {
    const user = userEvent.setup();
    renderPalette(['fac-a']);

    await user.click(row('Lakeside Pediatrics'));

    expect(screen.getByRole('button', { name: /Select 2 facilities/ })).toBeInTheDocument();

    await user.click(row('Downtown Wellness Center'));

    expect(screen.getByRole('button', { name: /Select 3 facilities/ })).toBeInTheDocument();
  });
});

describe('FacilityScopePalette — applying', () => {
  it('the "All facilities" chip applies the global scope immediately and closes', async () => {
    const user = userEvent.setup();
    const { onApply, onOpenChange } = renderPalette(['fac-a']);

    await user.click(chip('All facilities'));

    expect(onApply).toHaveBeenCalledWith([]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('applies a single selection', async () => {
    const user = userEvent.setup();
    const { onApply } = renderPalette();

    await user.click(row('Downtown Wellness Center'));
    await user.click(screen.getByRole('button', { name: /Select 1 facility/ }));

    expect(onApply).toHaveBeenCalledWith(['fac-b']);
  });

  it("applies a comparison in the facilities' own order, not click order", async () => {
    const user = userEvent.setup();
    const { onApply } = renderPalette();

    await user.click(row('Lakeside Pediatrics'));
    await user.click(row('Northside Clinic'));
    await user.click(screen.getByRole('button', { name: /Select 2 facilities/ }));

    expect(onApply).toHaveBeenCalledWith(['fac-a', 'fac-c']);
  });
});

describe('FacilityScopePalette — keyboard', () => {
  it('selects the active row with space and applies with enter', async () => {
    const user = userEvent.setup();
    const { onApply } = renderPalette();

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown} ');
    await user.keyboard('{Enter}');

    expect(onApply).toHaveBeenCalledWith(['fac-b']);
  });

  it('moves the active row with the arrow keys, wrapping at the ends', async () => {
    const user = userEvent.setup();
    const { onApply } = renderPalette();

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowUp} ');
    await user.keyboard('{Enter}');

    expect(onApply).toHaveBeenCalledWith(['fac-c']);
  });

  it('types a space into the query instead of selecting once a search is under way', async () => {
    const user = userEvent.setup();
    const { onApply } = renderPalette();

    await user.type(screen.getByRole('combobox'), 'lakeside pediatrics');

    expect(screen.getByRole('combobox')).toHaveValue('lakeside pediatrics');
    expect(rows()).toHaveLength(1);
    expect(row('Lakeside Pediatrics')).toHaveAttribute('aria-selected', 'false');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('closes without applying on escape', async () => {
    const user = userEvent.setup();
    const { onApply, onOpenChange } = renderPalette();

    await user.click(row('Northside Clinic'));
    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('FacilityScopePalette — close button (#22)', () => {
  it('exposes an accessible "Close" button and no longer renders the literal text "esc"', () => {
    renderPalette();

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByText('esc')).not.toBeInTheDocument();
  });

  it('calls onOpenChange(false) without applying when clicked', async () => {
    const user = userEvent.setup();
    const { onApply, onOpenChange } = renderPalette();

    await user.click(row('Northside Clinic'));
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onApply).not.toHaveBeenCalled();
  });
});
