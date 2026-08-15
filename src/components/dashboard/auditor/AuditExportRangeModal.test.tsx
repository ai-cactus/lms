/**
 * Every Audit Reports export now routes through this modal, so its contract —
 * both bounds optional ("all time"), From never after To — is what keeps a
 * malformed range from reaching the export worker.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The shared DatePicker portals a calendar to <body>; swap it for a plain input
// so these tests exercise the modal's range contract, not the picker's grid.
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (next: string) => void;
    label?: string;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import AuditExportRangeModal from './AuditExportRangeModal';

const onGenerate = vi.fn();
const onOpenChange = vi.fn();

function renderModal() {
  return render(<AuditExportRangeModal open onOpenChange={onOpenChange} onGenerate={onGenerate} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuditExportRangeModal', () => {
  it('generates an unbounded ("all time") export when both dates are left empty', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: /generate report/i }));

    expect(onGenerate).toHaveBeenCalledExactlyOnceWith({});
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('passes only the bound that was filled in for a one-sided range', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText('Export range start date'), '2026-01-01');
    await user.click(screen.getByRole('button', { name: /generate report/i }));

    expect(onGenerate).toHaveBeenCalledExactlyOnceWith({ from: '2026-01-01' });
  });

  it('passes both bounds for a full range', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText('Export range start date'), '2026-01-01');
    await user.type(screen.getByLabelText('Export range end date'), '2026-03-31');
    await user.click(screen.getByRole('button', { name: /generate report/i }));

    expect(onGenerate).toHaveBeenCalledExactlyOnceWith({
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('blocks generation and explains why when From is after To', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText('Export range start date'), '2026-05-01');
    await user.type(screen.getByLabelText('Export range end date'), '2026-01-01');

    expect(screen.getByRole('button', { name: /generate report/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/must be on or before/i);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('closes without generating when cancelled', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onGenerate).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
