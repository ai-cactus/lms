'use client';

import React, { useState, useRef, useEffect } from 'react';
import TimeKeeper from 'react-timekeeper';
import styles from './TimePicker.module.css';

interface TimePickerProps {
    value: string; // HH:MM
    onChange: (time: string) => void;
    placeholder?: string;
}

export default function TimePicker({ value, onChange, placeholder = 'Select time' }: TimePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleTimeChange = (newTime: any) => {
        onChange(newTime.formatted24);
        // Don't close immediately to allow minute selection if needed, 
        // but react-timekeeper has a "Done" button usually or we can click outside.
        // Or we can close on "formatted24" change if we want instant selection.
    };

    return (
        <div className={styles.container} ref={containerRef}>
            <div
                className={`${styles.inputWrapper} ${isOpen ? styles.active : ''}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={value ? styles.inputText : styles.placeholder}>
                    {value || placeholder}
                </span>
                <div className={styles.icon}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                </div>
            </div>

            {isOpen && (
                <div className={styles.clockPopover}>
                    <TimeKeeper
                        time={value || '12:00'}
                        onChange={handleTimeChange}
                        switchToMinuteOnHourSelect
                        onDoneClick={() => setIsOpen(false)}
                        switchToMinuteOnHourDropdownSelect
                    />
                </div>
            )}
        </div>
    );
}
