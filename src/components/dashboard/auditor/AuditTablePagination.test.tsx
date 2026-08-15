/**
 * Pagination is new to the Audit Reports tables, and both tables share this
 * footer — the entry counter and the page-size reset are what auditors read to
 * confirm they have seen every row.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import AuditTablePagination from './AuditTablePagination';

const onPageChange = vi.fn();
const onPageSizeChange = vi.fn();

function renderPagination(
  overrides: Partial<React.ComponentProps<typeof AuditTablePagination>> = {},
) {
  return render(
    <AuditTablePagination
      page={1}
      pageSize={10}
      totalEntries={50}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      label="Courses per page"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuditTablePagination', () => {
  it('reports the visible slice of the total entries', () => {
    renderPagination();
    expect(screen.getByText('Showing 1 to 10 of 50 entries')).toBeInTheDocument();
  });

  it('reports a partial final page', () => {
    renderPagination({ page: 5, totalEntries: 44 });
    expect(screen.getByText('Showing 41 to 44 of 44 entries')).toBeInTheDocument();
  });

  it('reports zero entries without an off-by-one start index', () => {
    renderPagination({ totalEntries: 0 });
    expect(screen.getByText('Showing 0 to 0 of 0 entries')).toBeInTheDocument();
  });

  it('lists every page when the run is short enough', () => {
    renderPagination();
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('button', { name: /^Page \d+$/ })).toHaveLength(5);
  });

  it('collapses long page runs behind an ellipsis', () => {
    renderPagination({ totalEntries: 100 });
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 10' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 5' })).not.toBeInTheDocument();
  });

  it('disables the previous control on the first page and the next control on the last', () => {
    const { unmount } = renderPagination();
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next page/i })).toBeEnabled();
    unmount();

    renderPagination({ page: 5 });
    expect(screen.getByRole('button', { name: /previous page/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  it('moves between pages', async () => {
    const user = userEvent.setup();
    renderPagination();

    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(3);

    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
  });

  it('exposes the page-size select under the caller-supplied label', () => {
    renderPagination();
    expect(screen.getByRole('combobox', { name: 'Courses per page' })).toHaveTextContent('10');
  });
});
