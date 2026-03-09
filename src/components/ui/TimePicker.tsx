'use client';

import React, { useState, useEffect } from 'react';
import styles from './TimePicker.module.css';

interface TimePickerProps {
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
}

function parseTime(input: string): string {
  if (!input || !input.trim()) return '';

  const str = input.toLowerCase().replace(/\s+/g, '');

  let modifier = '';
  if (str.includes('p')) modifier = 'PM';
  else if (str.includes('a')) modifier = 'AM';

  const digits = str.replace(/\D/g, '');
  let hours = 0;
  let minutes = 0;

  if (digits.length === 0) return input; // Return original if totally invalid

  if (digits.length <= 2) {
    hours = parseInt(digits, 10);
    minutes = 0;
  } else if (digits.length === 3) {
    hours = parseInt(digits.substring(0, 1), 10);
    minutes = parseInt(digits.substring(1), 10);
  } else {
    hours = parseInt(digits.substring(0, 2), 10);
    minutes = parseInt(digits.substring(2, 4), 10);
  }

  if (hours > 24 || minutes > 59) return input; // Invalid, just return what they typed

  if (hours >= 12) {
    if (hours > 12) hours -= 12;
    if (!modifier) modifier = 'PM';
  } else if (hours === 0) {
    hours = 12;
    modifier = 'AM';
  } else {
    if (!modifier) modifier = 'AM';
  }

  const minsStr = minutes.toString().padStart(2, '0');
  return `${hours}:${minsStr} ${modifier}`;
}

// Convert 24h format (like "13:00") from parent data back to 12h format for display
function formatDisplayValue(val: string): string {
  if (!val) return '';
  const match = val.match(/^(\d{2}):(\d{2})$/);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const mod = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2, '0')} ${mod}`;
  }
  return val; // Already 12h format or invalid
}

export default function TimePicker({
  value,
  onChange,
  placeholder = 'e.g. 1:00 PM',
}: TimePickerProps) {
  const [inputValue, setInputValue] = useState(formatDisplayValue(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync input with external value when not focused
      setInputValue(formatDisplayValue(value));
    }
  }, [value, isFocused]);

  const handleBlur = () => {
    setIsFocused(false);
    const parsed = parseTime(inputValue);
    setInputValue(parsed);
    onChange(parsed); // The user requested 12-hour format, so we pass the formatted "1:00 PM" string
  };

  return (
    <div className={styles.container}>
      <div className={`${styles.inputWrapper} ${isFocused ? styles.active : ''}`}>
        <input
          type="text"
          className={styles.inputText}
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            width: '100%',
            color: 'inherit',
            fontSize: 'inherit',
          }}
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleBlur();
          }}
        />
        <div className={styles.icon}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </div>
      </div>
    </div>
  );
}
