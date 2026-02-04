'use client';

import React, { useState, useRef, useEffect } from 'react';
import styles from '../CourseWizard.module.css';
import DatePicker from '@/components/ui/DatePicker';
import TimePicker from '@/components/ui/TimePicker';

interface Step7PublishProps {
    data: any;
    onChange: (field: string, value: any) => void;
}

interface Worker {
    id: string;
    name: string;
    email: string;
    initials: string;
}

const MOCK_WORKERS: Worker[] = [
    { id: '1', name: 'Sarah Wilson', email: 'sarah@theraptly.com', initials: 'SW' },
    { id: '2', name: 'James Rodriguez', email: 'james@theraptly.com', initials: 'JR' },
    { id: '3', name: 'Emily Chen', email: 'emily@theraptly.com', initials: 'EC' },
    { id: '4', name: 'David Kim', email: 'david@theraptly.com', initials: 'DK' },
];

export default function Step7Publish({ data, onChange }: Step7PublishProps) {
    const [inputValue, setInputValue] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Filter suggestions based on input
    const suggestions = inputValue
        ? MOCK_WORKERS.filter(w =>
            w.name.toLowerCase().includes(inputValue.toLowerCase()) ||
            w.email.toLowerCase().includes(inputValue.toLowerCase())
        ).filter(w => !data.assignments?.includes(w.email)) // Exclude already added
        : [];

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const val = inputValue.trim();
        const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

        if (e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault(); // Always prevent space character
            // Only create tag if it's a valid email
            if (isValidEmail) {
                addAssignment(val);
            }
            return;
        }

        if (['Enter', 'Tab', ','].includes(e.key)) {
            e.preventDefault();
            if (val) {
                // Enter/Tab always adds the tag (for names or emails)
                addAssignment(val);
            }
        } else if (e.key === 'Backspace' && !inputValue && data.assignments?.length > 0) {
            const newAssignments = [...(data.assignments || [])];
            newAssignments.pop();
            onChange('assignments', newAssignments);
        }
    };

    const addAssignment = (value: string) => {
        if (!value) return;
        const current = data.assignments || [];
        if (!current.includes(value)) {
            onChange('assignments', [...current, value]);
        }
        setInputValue('');
        setShowSuggestions(false);
    };

    const removeAssignment = (index: number) => {
        const current = data.assignments || [];
        const newAssignments = current.filter((_: any, i: number) => i !== index);
        onChange('assignments', newAssignments);
    };

    // Close suggestions on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className={styles.stepWrapper}>
            <h2 className={styles.stepTitle}>Finalize &amp; Publish</h2>
            <p className={styles.stepSubtitle}>
                Assign this course to your team members and set a due date for completion.
            </p>

            <div style={{ width: '100%', maxWidth: 600 }}>
                {/* Assign To Section */}
                <div style={{ marginBottom: 32 }}>
                    <label className={styles.label}>Assign to</label>
                    <div className={styles.chipInputWrapper} ref={wrapperRef} onClick={() => document.getElementById('assign-input')?.focus()}>
                        {(data.assignments || []).map((item: string, index: number) => (
                            <div key={index} className={styles.chip}>
                                {item}
                                <button className={styles.removeChip} onClick={(e) => { e.stopPropagation(); removeAssignment(index); }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                        ))}
                        <input
                            id="assign-input"
                            className={styles.chipInput}
                            placeholder={(data.assignments?.length === 0) ? "Type a name or email..." : ""}
                            value={inputValue}
                            onChange={(e) => {
                                setInputValue(e.target.value);
                                setShowSuggestions(true);
                            }}
                            onKeyDown={handleKeyDown}
                            onFocus={() => setShowSuggestions(true)}
                        />

                        {/* Autocomplete Dropdown */}
                        {showSuggestions && suggestions.length > 0 && (
                            <div className={styles.autocompleteDropdown}>
                                {suggestions.map(worker => (
                                    <div
                                        key={worker.id}
                                        className={styles.autocompleteItem}
                                        onClick={() => addAssignment(worker.email)}
                                    >
                                        <div className={styles.userAvatar}>{worker.initials}</div>
                                        <div className={styles.userInfo}>
                                            <span className={styles.userName}>{worker.name}</span>
                                            <span className={styles.userEmail}>{worker.email}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className={styles.helperText}>Suggested: Team members from your list</div>
                </div>

                {/* Due Date & Time Section */}
                <div className={styles.formRow}>
                    <div className={styles.inputGroup}>
                        <label className={styles.label}>Due Date</label>
                        <DatePicker
                            value={data.dueDate || ''}
                            onChange={(val) => onChange('dueDate', val)}
                        />
                    </div>
                    <div className={styles.inputGroup}>
                        <label className={styles.label}>Due Time</label>
                        <TimePicker
                            value={data.dueTime || ''}
                            onChange={(val) => onChange('dueTime', val)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
