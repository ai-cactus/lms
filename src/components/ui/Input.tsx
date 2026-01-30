'use client';

import React, { forwardRef, useState } from 'react';
import styles from './Input.module.css';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    helperText?: string;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(({
    label,
    error,
    helperText,
    leftIcon,
    rightIcon,
    type = 'text',
    className,
    id,
    ...props
}, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
    const isPassword = type === 'password';

    return (
        <div className={`${styles.inputWrapper} ${className || ''}`}>
            {label && (
                <label htmlFor={inputId} className={styles.label}>
                    {label}
                </label>
            )}
            <div className={`${styles.inputContainer} ${error ? styles.hasError : ''}`}>
                {leftIcon && <span className={styles.leftIcon}>{leftIcon}</span>}
                <input
                    ref={ref}
                    id={inputId}
                    type={isPassword ? (showPassword ? 'text' : 'password') : type}
                    className={`${styles.input} ${leftIcon ? styles.hasLeftIcon : ''} ${(rightIcon || isPassword) ? styles.hasRightIcon : ''}`}
                    {...props}
                />
                {isPassword && (
                    <button
                        type="button"
                        className={styles.passwordToggle}
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                    >
                        {showPassword ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                        )}
                    </button>
                )}
                {rightIcon && !isPassword && <span className={styles.rightIcon}>{rightIcon}</span>}
            </div>
            {error && <span className={styles.error}>{error}</span>}
            {helperText && !error && <span className={styles.helperText}>{helperText}</span>}
        </div>
    );
});

Input.displayName = 'Input';

export default Input;
