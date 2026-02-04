'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            // Check if click is inside the container OR inside the portal content (which we can't easily ref from here without more state, 
            // but react-timekeeper stops propagation usually, or we can rely on its own overlay if it had one.
            // Actually, for portals, checking containerRef is not enough.
            // We'll rely on a click listener on window that checks if target is within container or popover.
            // Since popover is in body, we need a ref for it too.
            const popoverEl = document.getElementById('time-picker-popover');
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node) &&
                popoverEl &&
                !popoverEl.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            window.addEventListener('mousedown', handleClickOutside);
            // Update position on scroll/resize
            const updatePosition = () => {
                if (containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect();
                    setPosition({
                        top: rect.bottom + window.scrollY,
                        left: rect.left + window.scrollX,
                        width: rect.width
                    });
                }
            };
            updatePosition();
            window.addEventListener('scroll', updatePosition, true);
            window.addEventListener('resize', updatePosition);

            return () => {
                window.removeEventListener('mousedown', handleClickOutside);
                window.removeEventListener('scroll', updatePosition, true);
                window.removeEventListener('resize', updatePosition);
            };
        }
    }, [isOpen]);

    const handleTimeChange = (newTime: any) => {
        onChange(newTime.formatted24);
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

            {isOpen && createPortal(
                <div
                    id="time-picker-popover"
                    className={styles.clockPopover}
                    style={{
                        position: 'absolute', // Fixed might be better if we handle scroll diffs, but absolute works with page coords
                        top: position.top + 8,
                        left: position.left,
                        zIndex: 9999
                    }}
                >
                    <TimeKeeper
                        time={value || '12:00'}
                        onChange={handleTimeChange}
                        switchToMinuteOnHourSelect
                        doneButton={() => <></>}
                        switchToMinuteOnHourDropdownSelect
                    />
                </div>,
                document.body
            )}
        </div>
    );
}
