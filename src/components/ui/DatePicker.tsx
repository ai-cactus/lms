'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './DatePicker.module.css';
import { Button } from '@/components/ui';

interface DatePickerProps {
    value: string; // YYYY-MM-DD
    onChange: (date: string) => void;
    placeholder?: string;
    label?: string;
    minDate?: Date; // Dates before this are disabled
}

export default function DatePicker({ value, onChange, placeholder = 'Select date', minDate }: DatePickerProps) {
    // Default minDate to start of today if not provided
    const effectiveMinDate = minDate || new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

    // Initialize calendar view state
    const today = new Date();
    const [viewDate, setViewDate] = useState(() => {
        if (value) {
            const [y, m, d] = value.split('-').map(Number);
            return new Date(y, m - 1, d);
        }
        return today;
    });

    // Close on outside click and position popover
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const popoverEl = document.getElementById('date-picker-popover');
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

    // Calendar Logic
    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth();
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

    const handlePrevMonth = (e: React.MouseEvent) => {
        e.stopPropagation();
        setViewDate(new Date(currentYear, currentMonth - 1, 1));
    };

    const handleNextMonth = (e: React.MouseEvent) => {
        e.stopPropagation();
        setViewDate(new Date(currentYear, currentMonth + 1, 1));
    };

    const handleDayClick = (day: number) => {
        const monthStr = String(currentMonth + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const dateStr = `${currentYear}-${monthStr}-${dayStr}`;
        onChange(dateStr);
        setIsOpen(false);
    };

    const formatDateDisplay = (dateStr: string) => {
        if (!dateStr) return '';
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    return (
        <div className={styles.container} ref={containerRef}>
            <div
                className={`${styles.inputWrapper} ${isOpen ? styles.active : ''}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={value ? styles.inputText : styles.placeholder}>
                    {value ? formatDateDisplay(value) : placeholder}
                </span>
                <div className={styles.icon}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                </div>
            </div>

            {isOpen && createPortal(
                <div
                    id="date-picker-popover"
                    className={styles.calendarPopover}
                    style={{
                        position: 'absolute',
                        top: position.top + 8,
                        left: position.left,
                        zIndex: 9999
                    }}
                >
                    <div className={styles.header}>
                        <Button variant="ghost" size="icon-sm" className={styles.navButton} onClick={handlePrevMonth}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="15 18 9 12 15 6"></polyline>
                            </svg>
                        </Button>
                        <div className={styles.monthTitle}>
                            {monthNames[currentMonth]} {currentYear}
                        </div>
                        <Button variant="ghost" size="icon-sm" className={styles.navButton} onClick={handleNextMonth}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </Button>
                    </div>

                    <div className={styles.grid}>
                        {dayLabels.map(day => (
                            <div key={day} className={styles.dayLabel}>{day}</div>
                        ))}

                        {/* Empty cells for prev month offset */}
                        {Array.from({ length: firstDay }).map((_, i) => (
                            <div key={`empty-${i}`} className={`${styles.dayButton} ${styles.empty}`} />
                        ))}

                        {/* Days */}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const monthStr = String(currentMonth + 1).padStart(2, '0');
                            const dayStr = String(day).padStart(2, '0');
                            const dateStr = `${currentYear}-${monthStr}-${dayStr}`;
                            const isSelected = value === dateStr;

                            // Check if today
                            const isToday = today.getDate() === day && today.getMonth() === currentMonth && today.getFullYear() === currentYear;

                            // Check if before minDate
                            const thisDate = new Date(currentYear, currentMonth, day);
                            const isPast = thisDate < effectiveMinDate;

                            return (
                                <button
                                    key={day}
                                    className={`
                                        ${styles.dayButton} 
                                        ${isSelected ? styles.selected : ''}
                                        ${isToday && !isSelected ? styles.today : ''}
                                        ${isPast ? styles.disabled : ''}
                                    `}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isPast) handleDayClick(day);
                                    }}
                                    disabled={isPast}
                                >
                                    {day}
                                </button>
                            );
                        })}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
