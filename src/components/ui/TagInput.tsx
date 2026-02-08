'use client';

import React, { useState, useRef, KeyboardEvent, ChangeEvent } from 'react';
import styles from './TagInput.module.css';

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
        const tags = paste.split(/[\n,;\s]+/).map(tag => tag.trim()).filter(Boolean);

        if (tags.length > 0) {
            const newTags = [...value];
            const invalidTags: string[] = [];

            tags.forEach(tag => {
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
        <div className={styles.container}>
            <div
                className={`${styles.wrapper} ${error || inputError ? styles.hasError : ''}`}
                onClick={handleClick}
                ref={containerRef}
            >
                {value.map((tag, index) => (
                    <div key={index} className={`${styles.tag} ${validate && !validate(tag) ? styles.invalidTag : ''}`}>
                        <span>{tag}</span>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeTag(index); }}
                            className={styles.removeButton}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
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
                    className={styles.input}
                />
            </div>
            {(error || inputError) && <span className={styles.errorMessage}>{inputError || error}</span>}
            <div className={styles.hint}>
                Press Enter or Comma to add
            </div>
        </div>
    );
}
