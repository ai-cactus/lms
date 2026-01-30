import React from 'react';
import Image from 'next/image';
import styles from './Logo.module.css';

interface LogoProps {
    size?: 'sm' | 'md' | 'lg';
    showText?: boolean;
    variant?: 'light' | 'dark' | 'blue';
    className?: string;
}

export default function Logo({
    size = 'md',
    showText = true,
    variant = 'light',
    className = ''
}: LogoProps) {
    const sizes = {
        sm: { icon: 32, fontSize: 20 },
        md: { icon: 48, fontSize: 28 },
        lg: { icon: 64, fontSize: 36 },
    };

    const { icon, fontSize } = sizes[size];

    return (
        <div className={`${styles.logo} ${className} ${styles[variant]}`}>
            <Image
                src="/images/logo-icon.svg"
                alt="Theraptly Logo"
                width={icon}
                height={icon}
                priority
            />
            {showText && (
                <span
                    className={`${styles.logoText} ${styles[variant]}`}
                    style={{ fontSize }}
                >
                    Theraptly
                </span>
            )}
        </div>
    );
}
