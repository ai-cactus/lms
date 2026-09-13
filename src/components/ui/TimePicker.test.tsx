/**
 * Unit tests for TimePicker (rewritten in the assign-deadline-time phase to
 * portal to `<body>`, mirroring DatePicker's `placement`/`className` props).
 * No test file existed for this component before this phase, despite it
 * having three consumers — one of them (the course wizard's Step7Assign)
 * predating this rewrite, with no e2e coverage that would catch a regression
 * there.
 *
 * Covers: default placement stays `bottom-start` (the wizard's usage is
 * unchanged), `top-end` positions on the opposite side, the `<body>` portal,
 * outside-click-closes vs. inside-click-stays-open, and the `"H:MM AM/PM"`
 * value round trip `combineDateAndTime` accepts.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TimePicker from './TimePicker';
import { combineDateAndTime } from '@/lib/reminders/deadline';

function openPicker(placeholder = 'e.g. 1:00 PM') {
  fireEvent.focus(screen.getByPlaceholderText(placeholder));
}

describe('TimePicker — placement', () => {
  it('defaults to bottom-start when no placement prop is given (the wizard usage)', () => {
    render(<TimePicker value="" onChange={vi.fn()} />);
    openPicker();

    const popover = document.getElementById('time-picker-popover');
    expect(popover).not.toBeNull();
    // bottom-start anchors below the trigger with no transform flip.
    expect(popover).toHaveStyle({ top: '8px' });
    expect(popover?.style.transform).toBe('');
  });

  it('positions on the opposite side (transform-flipped) for placement="top-end"', () => {
    render(<TimePicker value="" onChange={vi.fn()} placement="top-end" />);
    openPicker();

    const popover = document.getElementById('time-picker-popover');
    expect(popover).not.toBeNull();
    expect(popover).toHaveStyle({ top: '-8px', transform: 'translate(-100%, -100%)' });
  });
});

describe('TimePicker — portal', () => {
  it('portals the open clock to <body> under id "time-picker-popover"', () => {
    render(
      <div data-testid="host">
        <TimePicker value="" onChange={vi.fn()} />
      </div>,
    );
    openPicker();

    const popover = document.getElementById('time-picker-popover');
    expect(popover).not.toBeNull();
    expect(popover?.parentElement).toBe(document.body);
    // Not a descendant of the component's own host subtree.
    expect(screen.getByTestId('host').contains(popover)).toBe(false);
  });

  it('is not rendered at all while closed', () => {
    render(<TimePicker value="" onChange={vi.fn()} />);
    expect(document.getElementById('time-picker-popover')).toBeNull();
  });
});

describe('TimePicker — outside vs. inside clicks', () => {
  it('closes when clicking outside both the trigger and the portalled clock', () => {
    render(
      <>
        <div data-testid="outside">elsewhere</div>
        <TimePicker value="" onChange={vi.fn()} />
      </>,
    );
    openPicker();
    expect(document.getElementById('time-picker-popover')).not.toBeNull();

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(document.getElementById('time-picker-popover')).toBeNull();
  });

  it('does NOT close when clicking inside the portalled clock', () => {
    render(<TimePicker value="" onChange={vi.fn()} />);
    openPicker();
    const popover = document.getElementById('time-picker-popover');
    expect(popover).not.toBeNull();

    // The AM button lives inside the portal, not inside the trigger wrapper —
    // this is exactly the click the outside-click guard must not treat as
    // "outside" now that the clock is portalled away from its trigger.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'AM' }));

    expect(document.getElementById('time-picker-popover')).not.toBeNull();
  });
});

describe('TimePicker — value round trip', () => {
  it('emits the canonical "H:MM AM/PM" shape when hour, minute and meridiem are picked', () => {
    const onChange = vi.fn();
    render(<TimePicker value="" onChange={onChange} />);
    openPicker();

    // Hour "9" on the analog face (the number-ring group, not the angle-math
    // click handler — deterministic regardless of SVG layout/geometry).
    fireEvent.click(screen.getByText('9'));
    // Jump straight to the minutes tab rather than waiting on the 200ms
    // auto-advance timeout.
    fireEvent.click(screen.getByRole('button', { name: '00' }));
    fireEvent.click(screen.getByText('30'));
    fireEvent.click(screen.getByRole('button', { name: 'AM' }));

    expect(onChange).toHaveBeenLastCalledWith('9:30 AM');
  });

  it('round-trips a picked value through combineDateAndTime onto the intended UTC hour/minute', () => {
    const onChange = vi.fn();
    render(<TimePicker value="" onChange={onChange} />);
    openPicker();

    fireEvent.click(screen.getByText('9'));
    fireEvent.click(screen.getByRole('button', { name: '00' }));
    fireEvent.click(screen.getByText('30'));
    fireEvent.click(screen.getByRole('button', { name: 'AM' }));

    const emitted = onChange.mock.calls.at(-1)?.[0] as string;
    const combined = combineDateAndTime(new Date('2026-08-01T00:00:00.000Z'), emitted);
    expect(combined?.toISOString()).toBe('2026-08-01T09:30:00.000Z');
  });

  it('re-displays a controlled value passed back in as the same "H:MM AM/PM" text', () => {
    render(<TimePicker value="5:45 PM" onChange={vi.fn()} placeholder="Select due time" />);

    expect(screen.getByPlaceholderText('Select due time')).toHaveValue('5:45 PM');
  });
});
