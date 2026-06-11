'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}

/**
 * Segmented one-time-code input: `length` single-digit boxes with auto-advance,
 * backspace-to-previous, arrow nav, and paste-to-fill. `value` is the joined
 * string; `onComplete` fires once all boxes are filled.
 */
function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  ariaLabel = 'Verification code',
}: OtpInputProps) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);

  const digits = React.useMemo(() => {
    const arr = value.split('').slice(0, length);
    while (arr.length < length) arr.push('');
    return arr;
  }, [value, length]);

  // Mirror of `value` updated synchronously inside handlers so a rapid burst of
  // keystrokes (fast typer / autofill) doesn't read a stale prop before React re-renders.
  const latest = React.useRef(value);
  React.useEffect(() => {
    latest.current = value;
  }, [value]);

  React.useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const handleChange = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    const arr = latest.current.split('').slice(0, length);
    while (arr.length < length) arr.push('');
    arr[index] = digit;
    const joined = arr.join('');
    latest.current = joined;
    onChange(joined);

    if (digit && index < length - 1) refs.current[index + 1]?.focus();
    if (digit && index === length - 1 && joined.length === length) {
      onComplete?.(joined);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) refs.current[index - 1]?.focus();
    if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < length - 1) refs.current[index + 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    latest.current = pasted;
    onChange(pasted);
    if (pasted.length === length) onComplete?.(pasted);
    else refs.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-3" role="group" aria-label={ariaLabel}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          aria-label={`Digit ${i + 1}`}
          className={cn(
            'size-12 rounded-lg border text-center text-xl font-semibold text-foreground outline-none transition-colors',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'disabled:cursor-not-allowed disabled:opacity-50',
            digit ? 'border-primary bg-primary/5' : 'border-input bg-transparent',
          )}
        />
      ))}
    </div>
  );
}

export { OtpInput };
