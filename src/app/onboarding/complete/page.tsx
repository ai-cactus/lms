'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import styles from '../onboarding.module.css'; // Utilizing layout styles but adding custom overrides inline or via new module if needed

export default function OnboardingComplete() {
    const router = useRouter();

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            textAlign: 'center',
            gap: '24px'
        }}>
            {/* Success Icon/Illustration */}
            <div style={{ position: 'relative', width: '120px', height: '120px' }}>
                {/* Outer sparkles/decorations could be SVGs, keeping it simple for now or using the reference if provided */}
                <div style={{
                    width: '80px',
                    height: '80px',
                    background: '#E0E7FF',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto',
                    position: 'absolute',
                    top: '20px',
                    left: '20px',
                    zIndex: 1
                }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        background: '#4C6EF5',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white'
                    }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </div>
                </div>

                {/* Decorative Sparkles - Simulated with simple SVGs positioned absolutely */}
                <svg style={{ position: 'absolute', top: '0', left: '50%', transform: 'translateX(-50%)', color: '#4C6EF5' }} width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L14.4 7.2L20 9.6L14.4 12L12 17.2L9.6 12L4 9.6L9.6 7.2L12 2Z" />
                </svg>
                <svg style={{ position: 'absolute', bottom: '0', right: '0', color: '#4C6EF5' }} width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L14.4 7.2L20 9.6L14.4 12L12 17.2L9.6 12L4 9.6L9.6 7.2L12 2Z" />
                </svg>
                <svg style={{ position: 'absolute', top: '40%', left: '-10px', color: '#4C6EF5' }} width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L14.4 7.2L20 9.6L14.4 12L12 17.2L9.6 12L4 9.6L9.6 7.2L12 2Z" />
                </svg>
            </div>

            <div style={{ marginTop: '24px' }}>
                <h1 style={{ fontSize: '32px', fontWeight: 700, color: '#1A202C', marginBottom: '12px' }}>
                    You're all <span style={{ color: '#4C6EF5' }}>Set!</span>
                </h1>
                <p style={{ fontSize: '16px', color: '#718096', maxWidth: '400px' }}>
                    Your account has been created successfully. You can now explore the dashboard!
                </p>
            </div>

            <div style={{ marginTop: '24px' }}>
                <Button variant="primary" onClick={() => router.push('/dashboard')} style={{ padding: '12px 32px' }}>
                    Go to Dashboard
                </Button>
            </div>
        </div>
    );
}
