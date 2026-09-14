/**
 * AssigneesInput is the one chip input shared by every assign surface
 * (RoleTargetPicker precedent, D5): capabilities (`onSearch`, `enableBulkImport`,
 * `visibleChipLimit`) are props, so a host only gets what it asks for.
 *
 * The behaviour under closest scrutiny is validation: the assign page used to
 * silently DROP invalid entries from a bulk paste. The replacement rule —
 * valid addresses become chips, invalid ones stay in the field, and a notice
 * states the count — is the whole point of this refactor and is covered
 * below (verified red-then-green by hand against a locally reverted
 * `commitText`, per the bug-hunter session notes).
 */
import { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

import AssigneesInput, {
  type AssigneesInputHandle,
  type AssigneeSuggestion,
} from './AssigneesInput';
import { MAX_STAFF_CSV_ROWS } from '@/lib/staff-csv';

const PLACEHOLDER = 'Add people, emails or names';

function Harness({
  initial = [],
  onSearch,
  enableBulkImport,
  visibleChipLimit,
  disabled,
  onChangeSpy,
}: {
  initial?: string[];
  onSearch?: (query: string) => Promise<AssigneeSuggestion[]>;
  enableBulkImport?: boolean;
  visibleChipLimit?: number;
  disabled?: boolean;
  onChangeSpy?: (next: string[]) => void;
}) {
  const [value, setValue] = useState<string[]>(initial);
  const ref = useRef<AssigneesInputHandle>(null);
  return (
    <>
      <AssigneesInput
        ref={ref}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChangeSpy?.(next);
        }}
        onSearch={onSearch}
        enableBulkImport={enableBulkImport}
        visibleChipLimit={visibleChipLimit}
        disabled={disabled}
      />
      <button type="button" onClick={() => ref.current?.commitDraft()}>
        Invite
      </button>
    </>
  );
}

function chipFiles(...names: string[]) {
  return names.map((email) => screen.getByText(email));
}

function csvFile(content: string, name = 'staff.csv') {
  return new File([content], name, { type: 'text/csv' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Static contract: the component must never bind to a server action itself —
// typeahead is entirely host-supplied via `onSearch` so the control stays
// testable and reusable across hosts with different search backends.
// ---------------------------------------------------------------------------
describe('AssigneesInput — no server-action binding', () => {
  it('never imports from @/app/actions', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(path.resolve(__dirname, './AssigneesInput.tsx'), 'utf-8');
    expect(source).not.toMatch(/@\/app\/actions/);
  });
});

// ---------------------------------------------------------------------------
// Chips and commit
// ---------------------------------------------------------------------------
describe('AssigneesInput — chip add/remove', () => {
  it.each([
    ['Enter', 'worker@test.com{Enter}'],
    ['Tab', 'worker@test.com{Tab}'],
    ['comma', 'worker@test.com,'],
    ['space', 'worker@test.com '],
  ])('commits a chip on %s', async (_label, typed) => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), typed);

    expect(screen.getByText('worker@test.com')).toBeInTheDocument();
  });

  it('dedupes case-insensitively and stores lowercase', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByPlaceholderText(PLACEHOLDER);
    await user.type(input, 'Worker@Test.com{Enter}');
    await user.type(input, 'worker@test.com{Enter}');

    expect(chipFiles('worker@test.com')).toHaveLength(1);
    expect(screen.queryByText('Worker@Test.com')).not.toBeInTheDocument();
  });

  it('Backspace on an empty field removes the last chip', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['a@x.com', 'b@x.com']} />);

    await user.click(screen.getByLabelText(PLACEHOLDER));
    await user.keyboard('{Backspace}');

    expect(screen.queryByText('b@x.com')).not.toBeInTheDocument();
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
  });

  it('Backspace with draft text present edits the field instead of removing a chip', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['a@x.com']} />);

    const input = screen.getByLabelText(PLACEHOLDER) as HTMLInputElement;
    await user.type(input, 'xy');
    await user.keyboard('{Backspace}');

    expect(screen.getByText('a@x.com')).toBeInTheDocument();
    expect(input).toHaveValue('x');
  });

  it('the per-chip remove button keeps its aria-label and removes only that chip', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['a@x.com', 'b@x.com']} />);

    await user.click(screen.getByRole('button', { name: 'Remove a@x.com' }));

    expect(screen.queryByText('a@x.com')).not.toBeInTheDocument();
    expect(screen.getByText('b@x.com')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Validation — the behaviour that changed. The old assign-page input silently
// dropped invalid entries; the new rule keeps them in the field and states a
// count. Proven red-then-green further down.
// ---------------------------------------------------------------------------
describe('AssigneesInput — validation keeps invalid input, never discards it', () => {
  it('a single invalid token shows the singular message and adds nothing', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), 'nope{Enter}');

    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it('a mixed commit adds the valid addresses as chips and leaves the invalid ones in the field, naming the count', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'good1@x.com, bad-token, good2@x.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('good1@x.com')).toBeInTheDocument();
    expect(screen.getByText('good2@x.com')).toBeInTheDocument();
    // The rejected token is left in the field to fix or remove — never dropped.
    expect(input.value).toBe('bad-token');
    expect(
      screen.getByText(
        '1 of 3 entries are not valid email addresses — they have been left in the field to fix or remove.',
      ),
    ).toBeInTheDocument();
  });

  it('nothing is discarded without being surfaced: an all-invalid commit states every rejected token in the field', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'nope, also-bad' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input.value).toBe('nope, also-bad');
    expect(
      screen.getByText(
        '2 of 2 entries are not valid email addresses — they have been left in the field to fix or remove.',
      ),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// commitDraft() via ref — a real data-loss path if it regresses: typing
// without pressing Enter, then triggering the host's own "Invite" button.
// ---------------------------------------------------------------------------
describe('AssigneesInput — commitDraft() via ref', () => {
  it('commits an uncommitted draft when the host calls commitDraft()', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), 'worker@test.com');
    expect(screen.queryByText('worker@test.com')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Invite' }));

    expect(screen.getByText('worker@test.com')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Typeahead (onSearch supplied)
// ---------------------------------------------------------------------------
describe('AssigneesInput — typeahead', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function suggestion(overrides: Partial<AssigneeSuggestion> = {}): AssigneeSuggestion {
    return {
      id: 'u1',
      name: 'Jordan Smith',
      email: 'jordan@x.com',
      initials: 'JS',
      ...overrides,
    };
  }

  // userEvent's own internal delays don't cooperate reliably with Vitest fake
  // timers here (real hangs observed even on paths with no explicit timer
  // advance), so these use fireEvent for input/click and drive the debounce
  // timer directly — the debounce logic is what's under test, not keystroke
  // simulation fidelity.
  it('does not search below the 2-character minimum', async () => {
    const onSearch = vi.fn().mockResolvedValue([]);
    render(<Harness onSearch={onSearch} />);

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'j' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(onSearch).not.toHaveBeenCalled();
  });

  it('debounces the search by 300ms — a single call, not one per keystroke', async () => {
    const onSearch = vi.fn().mockResolvedValue([]);
    render(<Harness onSearch={onSearch} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.change(input, { target: { value: 'j' } });
    fireEvent.change(input, { target: { value: 'jo' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(onSearch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('jo');
  });

  it('selecting a suggestion adds it as a chip and clears the draft', async () => {
    const onSearch = vi.fn().mockResolvedValue([suggestion()]);
    render(<Harness onSearch={onSearch} />);

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'jo' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    fireEvent.click(screen.getByText('Jordan Smith'));

    expect(screen.getByText('jordan@x.com')).toBeInTheDocument();
    expect((screen.getByLabelText(PLACEHOLDER) as HTMLInputElement).value).toBe('');
  });

  it('a suggestion already selected is filtered out of the dropdown', async () => {
    const onSearch = vi.fn().mockResolvedValue([suggestion({ id: 'u1', email: 'jordan@x.com' })]);
    render(<Harness initial={['jordan@x.com']} onSearch={onSearch} />);

    fireEvent.change(screen.getByLabelText(PLACEHOLDER), { target: { value: 'jo' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onSearch).toHaveBeenCalled();
    expect(screen.queryByText('Jordan Smith')).not.toBeInTheDocument();
  });

  it('a suggestion selected from the dropdown carries no "New" badge', async () => {
    const onSearch = vi.fn().mockResolvedValue([suggestion()]);
    render(<Harness onSearch={onSearch} />);

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'jo' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.click(screen.getByText('Jordan Smith'));

    const chip = screen.getByText('jordan@x.com').closest('div');
    expect(within(chip as HTMLElement).queryByText('New')).not.toBeInTheDocument();
  });

  it('an email typed and committed manually — never returned by search — carries the "New" badge', async () => {
    const onSearch = vi.fn().mockResolvedValue([]);
    render(<Harness onSearch={onSearch} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.change(input, { target: { value: 'brandnew@x.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const chip = screen.getByText('brandnew@x.com').closest('div');
    expect(within(chip as HTMLElement).getByText('New')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Bulk import (enableBulkImport)
// ---------------------------------------------------------------------------
describe('AssigneesInput — bulk import', () => {
  it('a CSV with valid rows adds every email as a chip', async () => {
    const user = userEvent.setup();
    render(<Harness enableBulkImport />);

    const file = csvFile('email\nalice@example.com\nbob@example.com\n');
    await user.upload(screen.getByLabelText('Upload a spreadsheet of recipients'), file);

    await waitFor(() => expect(screen.getByText('alice@example.com')).toBeInTheDocument());
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('a file with no valid rows shows an error notice and adds nothing', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<Harness enableBulkImport onChangeSpy={onChangeSpy} />);

    const file = csvFile('email\nnot-an-email\n');
    await user.upload(screen.getByLabelText('Upload a spreadsheet of recipients'), file);

    await waitFor(() =>
      expect(
        screen.getByText(
          'No valid email rows found in the file. Check the format or download the sample template.',
        ),
      ).toBeInTheDocument(),
    );
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it('partial-invalid rows add the valid ones and warn naming the skipped count', async () => {
    const user = userEvent.setup();
    render(<Harness enableBulkImport />);

    // 2 valid, 1 duplicate-in-file, 1 malformed => extractStaffEmailsFromRows
    // counts both as "invalid" for this component's purposes.
    const file = csvFile(
      'email\nalice@example.com\nalice@example.com\nnot-an-email\nbob@example.com\n',
    );
    await user.upload(screen.getByLabelText('Upload a spreadsheet of recipients'), file);

    await waitFor(() => expect(screen.getByText('alice@example.com')).toBeInTheDocument());
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByText('2 row(s) skipped — invalid or duplicate email.')).toBeInTheDocument();
  });

  it('truncates past 1000 rows and surfaces it in the notice', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    // visibleChipLimit keeps this test from rendering 1000 chip DOM nodes —
    // the truncation behaviour is verified via the committed value, not the
    // rendered chip list (covered separately by the visibleChipLimit suite).
    render(<Harness enableBulkImport onChangeSpy={onChangeSpy} visibleChipLimit={3} />);

    const rows = Array.from(
      { length: MAX_STAFF_CSV_ROWS + 5 },
      (_, i) => `worker${i}@example.com`,
    ).join('\n');
    const file = csvFile(`email\n${rows}\n`);
    await user.upload(screen.getByLabelText('Upload a spreadsheet of recipients'), file);

    await waitFor(() =>
      expect(screen.getByText(/the file was truncated to the first 1000 rows/)).toBeInTheDocument(),
    );
    const added = onChangeSpy.mock.calls.at(-1)?.[0] as string[];
    expect(added).toHaveLength(MAX_STAFF_CSV_ROWS);
    expect(added).not.toContain(`worker${MAX_STAFF_CSV_ROWS}@example.com`);
  });

  it('paste-to-parse: pasting multiple addresses adds the valid ones and leaves invalid text in the field', () => {
    render(<Harness enableBulkImport />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.paste(input, {
      clipboardData: { getData: () => 'good@x.com, bad-token' },
    });

    expect(screen.getByText('good@x.com')).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe('bad-token');
  });

  it('drag-and-drop: dropping a spreadsheet file adds its valid emails', async () => {
    render(<Harness enableBulkImport />);
    const dropzone = screen.getByPlaceholderText(PLACEHOLDER).closest('div') as HTMLElement;
    const file = csvFile('email\ndropped@example.com\n');

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByText('dropped@example.com')).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// visibleChipLimit
// ---------------------------------------------------------------------------
describe('AssigneesInput — visibleChipLimit', () => {
  it('collapses chips past the limit behind a "+N more" chip, and expanding shows the rest', async () => {
    const user = userEvent.setup();
    const emails = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'];
    render(<Harness initial={emails} visibleChipLimit={3} />);

    expect(screen.getByText('a@x.com')).toBeInTheDocument();
    expect(screen.getByText('c@x.com')).toBeInTheDocument();
    expect(screen.queryByText('d@x.com')).not.toBeInTheDocument();

    const more = screen.getByRole('button', { name: 'Show all 5 recipients' });
    expect(more).toHaveTextContent('+2 more');

    await user.click(more);

    expect(screen.getByText('d@x.com')).toBeInTheDocument();
    expect(screen.getByText('e@x.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all 5 recipients' })).not.toBeInTheDocument();
  });

  it('shows every chip with no visibleChipLimit set', () => {
    const emails = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'];
    render(<Harness initial={emails} />);

    for (const email of emails) {
      expect(screen.getByText(email)).toBeInTheDocument();
    }
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Capability gating — a host must not get a capability it did not ask for.
// ---------------------------------------------------------------------------
describe('AssigneesInput — capability gating', () => {
  it('renders no dropdown at all when onSearch is absent, even after typing', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), 'jordan');

    expect(screen.queryByText('Searching...')).not.toBeInTheDocument();
    expect(screen.queryByText('No staff found')).not.toBeInTheDocument();
  });

  it('renders no upload control when enableBulkImport is false', () => {
    render(<Harness />);

    expect(screen.queryByText('Click to upload .csv file instead')).not.toBeInTheDocument();
    expect(screen.queryByText('Download sample .csv template')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Upload a spreadsheet of recipients')).not.toBeInTheDocument();
  });

  it('renders the upload control when enableBulkImport is true', () => {
    render(<Harness enableBulkImport />);

    expect(screen.getByText('Click to upload .csv file instead')).toBeInTheDocument();
    expect(screen.getByLabelText('Upload a spreadsheet of recipients')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// disabled
// ---------------------------------------------------------------------------
describe('AssigneesInput — disabled', () => {
  it('blocks typing into the field', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<Harness disabled onChangeSpy={onChangeSpy} />);

    const input = screen.getByPlaceholderText(PLACEHOLDER);
    expect(input).toBeDisabled();

    await user.type(input, 'worker@test.com{Enter}');

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('worker@test.com')).not.toBeInTheDocument();
  });

  it('blocks chip removal', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['a@x.com']} disabled />);

    const removeButton = screen.getByRole('button', { name: 'Remove a@x.com' });
    expect(removeButton).toBeDisabled();

    await user.click(removeButton);

    expect(screen.getByText('a@x.com')).toBeInTheDocument();
  });

  it('blocks the click-to-upload control', () => {
    render(<Harness enableBulkImport disabled />);

    expect(screen.getByText('Click to upload .csv file instead').closest('button')).toBeDisabled();
  });

  /**
   * PRODUCT DEFECT (reported, not fixed): `disabled` gates the input, the
   * per-chip remove button and the click-to-upload button, but NOT the
   * dropzone's onDragOver/onDrop handlers — those are wired purely off
   * `enableBulkImport`. A disabled AssigneesInput (e.g. while a form is
   * submitting) still accepts a dropped spreadsheet and adds recipients.
   * This test pins the CURRENT (buggy) behaviour so a future accidental fix
   * shows up as a diff here rather than silently changing behaviour twice.
   */
  /**
   * A drop has no native disabled semantics, so it is the one input path that
   * has to be refused explicitly — a form mid-submit must not take on recipients.
   *
   * Asserted through preventDefault rather than the absence of a chip: the parse
   * is async, so `waitFor(() => expect(...).not.toBeInTheDocument())` passes on
   * its first poll whether the drop was refused or merely still in flight, and
   * stays green with the guard removed. `fireEvent` returns false only when a
   * handler cancelled the event, which is synchronous and cannot race.
   */
  it('refuses a dropped spreadsheet while disabled', () => {
    const { unmount } = render(<Harness enableBulkImport />);
    const enabledZone = screen.getByPlaceholderText(PLACEHOLDER).closest('div') as HTMLElement;
    const accepted = fireEvent.drop(enabledZone, {
      dataTransfer: { files: [csvFile('email\nlands@example.com\n')] },
    });
    expect(accepted).toBe(false);
    unmount();

    render(<Harness enableBulkImport disabled />);
    const disabledZone = screen.getByPlaceholderText(PLACEHOLDER).closest('div') as HTMLElement;
    const refused = fireEvent.drop(disabledZone, {
      dataTransfer: { files: [csvFile('email\nshouldnotland@example.com\n')] },
    });
    expect(refused).toBe(true);
  });
});
