'use client';

import React, { useState, useRef, KeyboardEvent, ChangeEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  validate?: (tag: string) => boolean;
  error?: string;
}

export default function TagInput({ value, onChange, placeholder, validate, error }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value.length - 1);
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setInputError('');
  };

  const handleBlur = () => {
    if (inputValue) {
      addTag(inputValue);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const paste = e.clipboardData.getData('text');
    // Split by comma, newline, space, or semicolon
    const tags = paste
      .split(/[\n,;\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (tags.length > 0) {
      const newTags = [...value];
      const invalidTags: string[] = [];

      tags.forEach((tag) => {
        if (!newTags.includes(tag)) {
          if (validate && !validate(tag)) {
            invalidTags.push(tag);
          } else {
            newTags.push(tag);
          }
        }
      });

      onChange(newTags);

      if (invalidTags.length > 0) {
        setInputValue(invalidTags.join(', '));
        setInputError('Invalid emails were not added');
      } else {
        setInputValue('');
      }
    }
  };

  const addTag = (tag: string) => {
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;

    if (value.includes(trimmedTag)) {
      setInputError('Duplicate email');
      return;
    }

    if (validate && !validate(trimmedTag)) {
      setInputError('Invalid email address');
      return;
    }

    onChange([...value, trimmedTag]);
    setInputValue('');
    setInputError('');
  };

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleClick = () => {
    containerRef.current?.querySelector('input')?.focus();
  };

  return (
    <div className="flex w-full flex-col">
      <div
        className={cn(
          'flex min-h-[3.5rem] w-full cursor-text flex-wrap items-center gap-2 rounded-[10px] border bg-background px-3 py-2 transition-colors',
          'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
          error || inputError
            ? 'border-destructive focus-within:ring-destructive/20'
            : 'border-input',
        )}
        onClick={handleClick}
        ref={containerRef}
      >
        {value.map((tag, index) => (
          <div
            key={index}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium',
              validate && !validate(tag) ? 'bg-error/15 text-error' : 'bg-accent text-foreground',
            )}
          >
            <span>{tag}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(index);
              }}
              className="flex items-center justify-center text-text-tertiary transition-colors hover:text-text-secondary"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onPaste={handlePaste}
          placeholder={value.length === 0 ? placeholder : ''}
          className="min-w-[120px] flex-1 border-none bg-transparent py-1 text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      {(error || inputError) && (
        <span className="mt-1 text-xs text-error">{inputError || error}</span>
      )}
      <div className="mt-1 text-xs text-text-tertiary">Press Enter or Comma to add</div>
    </div>
  );
}
