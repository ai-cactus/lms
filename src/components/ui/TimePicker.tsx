'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimePickerProps {
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Parse any reasonable user string → { h12, minutes, ampm } or null */
function parseUserInput(input: string): { h12: number; minutes: number; ampm: 'AM' | 'PM' } | null {
  if (!input.trim()) return null;
  const str = input.trim().toLowerCase();
  const isPm = str.includes('p');
  const isAm = str.includes('a');
  const digits = str.replace(/\D/g, '');
  if (!digits) return null;

  let h = 0;
  let m = 0;
  if (digits.length <= 2) {
    h = parseInt(digits, 10);
  } else if (digits.length === 3) {
    h = parseInt(digits[0], 10);
    m = parseInt(digits.slice(1), 10);
  } else {
    h = parseInt(digits.slice(0, 2), 10);
    m = parseInt(digits.slice(2, 4), 10);
  }

  if (h > 23 || m > 59) return null;

  let ampm: 'AM' | 'PM';
  if (isPm) {
    ampm = 'PM';
    if (h < 12) h += 12;
  } else if (isAm) {
    ampm = 'AM';
    if (h === 12) h = 0;
  } else {
    ampm = h >= 12 ? 'PM' : 'AM';
  }

  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { h12, minutes: m, ampm };
}

/** Format to "H:MM AM/PM" */
function format(h12: number, minutes: number, ampm: 'AM' | 'PM') {
  return `${h12}:${pad(minutes)} ${ampm}`;
}

/** Parse the stored value prop (may already be "H:MM AM/PM") */
function parseValue(val: string): { h12: number; minutes: number; ampm: 'AM' | 'PM' } {
  if (!val) return { h12: 12, minutes: 0, ampm: 'PM' };
  const parsed = parseUserInput(val);
  return parsed ?? { h12: 12, minutes: 0, ampm: 'PM' };
}

// ── Analog Clock Face ────────────────────────────────────────────────────────

interface ClockFaceProps {
  mode: 'hours' | 'minutes';
  h12: number;
  minutes: number;
  onSelectHour: (h: number) => void;
  onSelectMinute: (m: number) => void;
}

function ClockFace({ mode, h12, minutes, onSelectHour, onSelectMinute }: ClockFaceProps) {
  const SIZE = 220;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = 90; // number ring radius
  const DOT_R = 18; // hitbox / highlight circle

  // Hour numbers 1‑12 around the face
  const hourNumbers = Array.from({ length: 12 }, (_, i) => i + 1);

  // Minute ticks: 0,5,10…55
  const minuteNumbers = Array.from({ length: 12 }, (_, i) => i * 5);

  const angleFor = (n: number, total: number) => ((n / total) * 360 - 90) * (Math.PI / 180);

  // Hand angle
  const handAngleDeg = mode === 'hours' ? (h12 / 12) * 360 - 90 : (minutes / 60) * 360 - 90;
  const handAngleRad = handAngleDeg * (Math.PI / 180);
  const handX = CX + (R - DOT_R) * Math.cos(handAngleRad);
  const handY = CY + (R - DOT_R) * Math.sin(handAngleRad);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left - CX;
    const y = e.clientY - rect.top - CY;
    const angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
    const normalized = (angle + 360) % 360;

    if (mode === 'hours') {
      const h = Math.round(normalized / 30) % 12 || 12;
      onSelectHour(h);
    } else {
      const m = Math.round(normalized / 6) % 60;
      onSelectMinute(m);
    }
  };

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      onClick={handleClick}
      className="cursor-pointer select-none"
    >
      {/* Face */}
      <circle cx={CX} cy={CY} r={SIZE / 2 - 4} fill="#F7FAFF" stroke="#E2E8F0" strokeWidth={1.5} />

      {/* Ticks */}
      {Array.from({ length: 60 }, (_, i) => {
        const ang = ((i / 60) * 360 - 90) * (Math.PI / 180);
        const isMajor = i % 5 === 0;
        const r1 = SIZE / 2 - 8;
        const r2 = r1 - (isMajor ? 10 : 5);
        return (
          <line
            key={i}
            x1={CX + r1 * Math.cos(ang)}
            y1={CY + r1 * Math.sin(ang)}
            x2={CX + r2 * Math.cos(ang)}
            y2={CY + r2 * Math.sin(ang)}
            stroke={isMajor ? '#CBD5E0' : '#E2E8F0'}
            strokeWidth={isMajor ? 1.5 : 1}
          />
        );
      })}

      {/* Number ring */}
      {mode === 'hours' &&
        hourNumbers.map((n) => {
          const ang = angleFor(n, 12);
          const x = CX + R * Math.cos(ang);
          const y = CY + R * Math.sin(ang);
          const active = n === h12;
          return (
            <g
              key={n}
              onClick={(e) => {
                e.stopPropagation();
                onSelectHour(n);
              }}
            >
              <circle cx={x} cy={y} r={DOT_R} fill={active ? '#4C6EF5' : 'transparent'} />
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={13}
                fontWeight={active ? 700 : 500}
                fill={active ? 'white' : '#2D3748'}
              >
                {n}
              </text>
            </g>
          );
        })}

      {mode === 'minutes' &&
        minuteNumbers.map((n) => {
          const ang = angleFor(n, 60);
          const x = CX + R * Math.cos(ang);
          const y = CY + R * Math.sin(ang);
          const active = n === minutes;
          return (
            <g
              key={n}
              onClick={(e) => {
                e.stopPropagation();
                onSelectMinute(n);
              }}
            >
              <circle cx={x} cy={y} r={DOT_R} fill={active ? '#4C6EF5' : 'transparent'} />
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fontWeight={active ? 700 : 500}
                fill={active ? 'white' : '#2D3748'}
              >
                {pad(n)}
              </text>
            </g>
          );
        })}

      {/* Hand */}
      <line
        x1={CX}
        y1={CY}
        x2={handX}
        y2={handY}
        stroke="#4C6EF5"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {/* Centre dot */}
      <circle cx={CX} cy={CY} r={4} fill="#4C6EF5" />
      {/* Hand tip circle */}
      <circle cx={handX} cy={handY} r={DOT_R} fill="#4C6EF5" opacity={0.15} />
    </svg>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function TimePicker({
  value,
  onChange,
  placeholder = 'e.g. 1:00 PM',
}: TimePickerProps) {
  const parsed = parseValue(value);
  const [h12, setH12] = useState(parsed.h12);
  const [minutes, setMinutes] = useState(parsed.minutes);
  const [ampm, setAmpm] = useState<'AM' | 'PM'>(parsed.ampm);
  const [textInput, setTextInput] = useState(
    value ? format(parsed.h12, parsed.minutes, parsed.ampm) : '',
  );
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'hours' | 'minutes'>('hours');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Sync external value changes
  useEffect(() => {
    const p = parseValue(value);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: syncing controlled value prop into internal clock state
    setH12(p.h12);

    setMinutes(p.minutes);

    setAmpm(p.ampm);

    if (value) setTextInput(format(p.h12, p.minutes, p.ampm));
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMode('hours');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const emit = useCallback(
    (newH: number, newM: number, newAmpm: 'AM' | 'PM') => {
      const formatted = format(newH, newM, newAmpm);
      setTextInput(formatted);
      onChange(formatted);
    },
    [onChange],
  );

  const handleSelectHour = (h: number) => {
    setH12(h);
    emit(h, minutes, ampm);
    // Auto-advance to minutes after hour selection
    setTimeout(() => setMode('minutes'), 200);
  };

  const handleSelectMinute = (m: number) => {
    setMinutes(m);
    emit(h12, m, ampm);
  };

  const handleAmpm = (val: 'AM' | 'PM') => {
    setAmpm(val);
    emit(h12, minutes, val);
  };

  const handleTextBlur = () => {
    const p = parseUserInput(textInput);
    if (p) {
      setH12(p.h12);
      setMinutes(p.minutes);
      setAmpm(p.ampm);
      emit(p.h12, p.minutes, p.ampm);
    } else if (!textInput.trim()) {
      setTextInput('');
      onChange('');
    } else {
      // Reset to last valid
      setTextInput(value ? format(h12, minutes, ampm) : '');
    }
  };

  const displayTime = format(h12, minutes, ampm);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      {/* Trigger / Text field row */}
      <div
        className={cn(
          'flex h-14 w-full select-none items-center justify-between rounded-[10px] border bg-background px-4 transition-colors',
          open
            ? 'border-ring ring-[3px] ring-ring/50'
            : 'border-input hover:border-ring/60 hover:bg-background-secondary',
        )}
      >
        <input
          type="text"
          className="w-full border-none bg-transparent text-base font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
          placeholder={placeholder}
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={handleTextBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleTextBlur();
              setOpen(false);
            }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
          className="flex cursor-pointer items-center border-none bg-transparent p-0 text-text-tertiary"
        >
          <Clock className="size-[18px]" aria-hidden="true" />
        </button>
      </div>

      {/* Clock popover */}
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+8px)] z-50 rounded-xl border border-border bg-background shadow-lg"
          onMouseDown={(e) => e.preventDefault()} // prevent blur on clock click
        >
          {/* Digital time display + AM/PM toggle */}
          <div className="flex items-center justify-center gap-2 px-4 pb-2 pt-4">
            <button
              onClick={() => setMode('hours')}
              className={cn(
                'cursor-pointer rounded-lg border-none px-2.5 py-1 text-[28px] font-bold',
                mode === 'hours'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-background-secondary text-foreground',
              )}
            >
              {pad(h12)}
            </button>
            <span className="text-[28px] font-bold text-foreground">:</span>
            <button
              onClick={() => setMode('minutes')}
              className={cn(
                'cursor-pointer rounded-lg border-none px-2.5 py-1 text-[28px] font-bold',
                mode === 'minutes'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-background-secondary text-foreground',
              )}
            >
              {pad(minutes)}
            </button>
            {/* AM / PM */}
            <div className="ml-1 flex flex-col gap-1">
              {(['AM', 'PM'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => handleAmpm(a)}
                  className={cn(
                    'cursor-pointer rounded-md border-2 px-2 py-[3px] text-xs font-bold',
                    ampm === a
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background text-text-secondary',
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Mode label */}
          <div className="mb-1 text-center text-[11px] text-text-tertiary">
            {mode === 'hours' ? 'Select hour' : 'Select minute'}
          </div>

          {/* Clock face */}
          <div className="flex justify-center px-4 pb-2">
            <ClockFace
              mode={mode}
              h12={h12}
              minutes={minutes}
              onSelectHour={handleSelectHour}
              onSelectMinute={handleSelectMinute}
            />
          </div>

          {/* OK button */}
          <div className="flex justify-end px-4 py-2 pb-3">
            <button
              onClick={() => {
                setOpen(false);
                setMode('hours');
              }}
              className="cursor-pointer rounded-lg border-none bg-primary px-5 py-[7px] text-[13px] font-semibold text-primary-foreground"
            >
              OK — {displayTime}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
