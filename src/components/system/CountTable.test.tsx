/**
 * CountTable was extracted from DeleteUserModal for reuse by the organization
 * modals. The extraction must leave the DOM the user modal renders exactly as
 * it was — the e2e spec for the user delete reads these rows by role and name.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CountTable from './CountTable';

describe('CountTable', () => {
  it('renders the heading, the two column headers and one row per entry, label left and count right', () => {
    render(
      <CountTable
        heading="Records retained:"
        rows={[
          { label: 'Certificates', count: 3 },
          { label: 'Quiz Attempts', count: 0 },
        ]}
      />,
    );

    const heading = screen.getByRole('heading', { level: 4, name: 'Records retained:' });
    expect(heading).toHaveClass('text-sm', 'font-semibold', 'text-foreground');
    expect(screen.getByRole('columnheader', { name: 'Record Type' })).toBeInTheDocument();
    const countHeader = screen.getByRole('columnheader', { name: 'Count' });
    expect(countHeader).toHaveClass('text-right');

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    const certificates = screen.getByRole('row', { name: /Certificates/ });
    const cells = within(certificates).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['Certificates', '3']);
    expect(cells[1]).toHaveClass('text-right');
    // A zero is a real count, not an omitted row.
    expect(within(screen.getByRole('row', { name: /Quiz Attempts/ })).getByText('0')).toBeVisible();
  });

  it('keeps the outer wrapper and the bordered table container the user modal styled', () => {
    const { container } = render(<CountTable heading="H" rows={[{ label: 'A', count: 1 }]} />);

    const wrapper = container.firstElementChild!;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.firstElementChild?.tagName).toBe('H4');
    expect(wrapper.lastElementChild).toHaveClass('rounded-[10px]', 'border', 'border-border');
    expect(wrapper.lastElementChild?.querySelector('table')).not.toBeNull();
  });
});
