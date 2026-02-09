'use client';

import React, { forwardRef } from 'react';
import styles from './Checkbox.module.css';

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: React.ReactNode;
    error?: string;
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({
    label,
    error,
    className,
    id,
    ...props
}, ref) => {
    const checkboxId = id || `checkbox-${Math.random().toString(36).substr(2, 9)}`;

    return (
        <div className={`${styles.container} ${className || ''}`}>
            <div className={styles.wrapper}>
                <input
                    type="checkbox"
                    ref={ref}
                    id={checkboxId}
                    className={styles.input}
                    {...props}
                />
                <label htmlFor={checkboxId} className={styles.customCheckbox}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1 6 4 9 11 1"></polyline>
                    </svg>
                </label>
                {label && (
                    <label htmlFor={checkboxId} className={styles.label}>
                        {label}
                    </label>
                )}
            </div>
            {error && <span className={styles.error}>{error}</span>}
        </div>
    );
});

Checkbox.displayName = 'Checkbox';

export default Checkbox;
