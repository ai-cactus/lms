'use client';

import React, { useState, useRef, useEffect } from 'react';
import styles from '../CourseWizard.module.css';
import DatePicker from '@/components/ui/DatePicker';
import TimePicker from '@/components/ui/TimePicker';

interface Step7PublishProps {
    data: any;
    onChange: (field: string, value: any) => void;
}

import { searchStaffUsers } from '@/app/actions/user';

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

export default function Step7Publish({ data, onChange }: Step7PublishProps) {
    const [inputValue, setInputValue] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [suggestions, setSuggestions] = useState<Worker[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [knownEmails, setKnownEmails] = useState<Set<string>>(new Set()); // Track existing org members
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (inputValue.length >= 2) {
                setIsLoading(true);
                try {
                    const results = await searchStaffUsers(inputValue);
                    // Track known emails from search results
                    setKnownEmails(prev => {
                        const updated = new Set(prev);
                        results.forEach((w: Worker) => updated.add(w.email));
                        return updated;
                    });
                    // Filter out already assigned
                    const available = results.filter((w: any) => !data.assignments?.includes(w.email));
                    setSuggestions(available);
                } catch (err) {
                    console.error("Failed to search staff", err);
                } finally {
                    setIsLoading(false);
                }
            } else {
                setSuggestions([]);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [inputValue, data.assignments]);

    const [validationError, setValidationError] = useState('');

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const val = inputValue.trim();
        const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

        if (e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            if (isValidEmail) {
                addAssignment(val);
                setValidationError('');
            } else if (val) {
                setValidationError('Please enter a valid email address');
            }
            return;
        }

        if (['Enter', 'Tab', ','].includes(e.key)) {
            e.preventDefault();
            if (val) {
                if (isValidEmail) {
                    addAssignment(val);
                    setValidationError('');
                } else {
                    setValidationError('Please enter a valid email address');
                }
            }
        } else if (e.key === 'Backspace' && !inputValue && data.assignments?.length > 0) {
            const newAssignments = [...(data.assignments || [])];
            newAssignments.pop();
            onChange('assignments', newAssignments);
            setValidationError('');
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
        setSuggestions([]);
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
                        {(data.assignments || []).map((item: string, index: number) => {
                            const isNewInvite = !knownEmails.has(item);
                            return (
                                <div key={index} className={`${styles.chip} ${isNewInvite ? styles.chipInvite : ''}`}>
                                    {item}
                                    {isNewInvite && <span className={styles.inviteBadge}>New</span>}
                                    <button className={styles.removeChip} onClick={(e) => { e.stopPropagation(); removeAssignment(index); }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="18" y1="6" x2="6" y2="18"></line>
                                            <line x1="6" y1="6" x2="18" y2="18"></line>
                                        </svg>
                                    </button>
                                </div>
                            );
                        })}
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
                        {showSuggestions && (inputValue.length >= 2 || suggestions.length > 0) && (
                            <div className={styles.autocompleteDropdown}>
                                {isLoading ? (
                                    <div style={{ padding: '10px', color: '#718096', fontSize: '14px' }}>Searching...</div>
                                ) : suggestions.length > 0 ? (
                                    suggestions.map(worker => (
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
                                    ))
                                ) : (
                                    inputValue.length >= 2 && <div style={{ padding: '10px', color: '#718096', fontSize: '14px' }}>No staff found</div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className={styles.helperText}>Type an email and press Enter. New emails will receive an invite with login credentials.</div>
                    {validationError && (
                        <div style={{ color: '#E53E3E', fontSize: '13px', marginTop: '6px' }}>{validationError}</div>
                    )}
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
