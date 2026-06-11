import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { OtpInput } from './otp-input';

function Harness({ onComplete }: { onComplete?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return <OtpInput value={value} onChange={setValue} onComplete={onComplete} />;
}

describe('OtpInput', () => {
  test('renders 6 boxes by default', () => {
    render(<OtpInput value="" onChange={() => {}} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  test('typing a digit fills the box and auto-advances focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const boxes = screen.getAllByRole('textbox');
    await user.click(boxes[0]);
    await user.keyboard('1');
    expect((boxes[0] as HTMLInputElement).value).toBe('1');
    expect(boxes[1]).toHaveFocus();
  });

  test('filling every box fires onComplete with the full code', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const boxes = screen.getAllByRole('textbox');
    const code = '123456';
    for (let i = 0; i < boxes.length; i++) {
      await user.click(boxes[i]);
      await user.keyboard(code[i]);
    }
    expect((boxes[5] as HTMLInputElement).value).toBe('6');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  test('paste fills all boxes and fires onComplete', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const boxes = screen.getAllByRole('textbox');
    await user.click(boxes[0]);
    await user.paste('654321');
    expect(onComplete).toHaveBeenCalledWith('654321');
    expect((boxes[0] as HTMLInputElement).value).toBe('6');
  });

  test('ignores non-numeric characters', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const boxes = screen.getAllByRole('textbox');
    await user.click(boxes[0]);
    await user.keyboard('a');
    expect((boxes[0] as HTMLInputElement).value).toBe('');
  });

  test('backspace on an empty box moves focus to the previous box', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const boxes = screen.getAllByRole('textbox');
    await user.click(boxes[0]);
    await user.keyboard('1');
    // focus is now on box[1], which is empty
    await user.keyboard('{Backspace}');
    expect(boxes[0]).toHaveFocus();
  });

  test('exposes a labelled group', () => {
    render(<OtpInput value="" onChange={() => {}} ariaLabel="2FA code" />);
    expect(screen.getByRole('group', { name: '2FA code' })).toBeInTheDocument();
  });
});
